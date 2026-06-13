import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdmin } from "@/lib/firebase/admin";
import { syncZohoMeetingConnectionFromCode } from "@/lib/server/meetings/service";
import { verifyBearerRequest } from "@/lib/server/request-auth";
import type { UserDoc } from "@/lib/types/user";

export const runtime = "nodejs";

const STATE_COOKIE = "zoho_meeting_oauth_state";
const RETURN_TO_COOKIE = "zoho_meeting_oauth_return_to";
const REDIRECT_URI_COOKIE = "zoho_meeting_oauth_redirect_uri";
const ACTOR_UID_COOKIE = "zoho_meeting_oauth_actor_uid";
const DEFAULT_RETURN_TO = "/crm/meetings/create";

type CallbackActorContext = {
  adminDb: Firestore;
  userDoc: UserDoc;
};

function resolveRequestOrigin(req: Request) {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host")?.trim();

  if (forwardedProto && host) {
    return `${forwardedProto}://${host}`;
  }

  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (publicAppUrl) {
    try {
      return new URL(publicAppUrl).origin;
    } catch {
      // ignore malformed public URL and fall back to request origin
    }
  }

  return url.origin;
}

function buildRedirect(origin: string, returnTo: string, status: "connected" | "error") {
  const target = new URL(returnTo, origin);
  target.searchParams.set("zoho", status);
  return NextResponse.redirect(target);
}

function clearOauthCookies(response: NextResponse) {
  response.cookies.set(STATE_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(RETURN_TO_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(REDIRECT_URI_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(ACTOR_UID_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });
}

async function readCallbackActorFromCookie(actorUid: string) {
  const normalizedUid = actorUid.trim();
  if (!normalizedUid) return null;

  const { adminDb } = await getAdmin();
  const userSnap = await adminDb.collection("users").doc(normalizedUid).get();
  if (!userSnap.exists) {
    return null;
  }

  return {
    adminDb,
    userDoc: {
      ...(userSnap.data() as UserDoc),
      uid: userSnap.id,
    },
  };
}

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const origin = resolveRequestOrigin(req);
  let verified: Awaited<ReturnType<typeof verifyBearerRequest>> | null = null;
  if (process.env.NODE_ENV !== "production") {
    try {
      // Temporary debug logging to help diagnose missing session cookie on OAuth redirect.
      // Logs will appear in the dev server console and should be removed after debugging.
      console.log("[DEBUG] Zoho OAuth callback request:", {
        url: req.url,
        cookie: req.headers.get("cookie"),
        userAgent: req.headers.get("user-agent"),
      });
    } catch (e) {
      // ignore logging errors
    }
  }
  const returnTo = requestUrl.searchParams.get("returnTo")?.trim()
    || requestUrl.searchParams.get("stateReturnTo")?.trim()
    || DEFAULT_RETURN_TO;
  const actorUidCookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACTOR_UID_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=") || "";

  try {
    verified = await verifyBearerRequest(req);
  } catch (error) {
    console.error("[ZOHO_CALLBACK_VERIFY_ERROR]", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestUrl: req.url,
      returnTo,
      resolvedOrigin: origin,
      forwardedProto: req.headers.get("x-forwarded-proto"),
      forwardedHost: req.headers.get("x-forwarded-host"),
      host: req.headers.get("host"),
    });
    verified = null;
  }

  let actorContext: CallbackActorContext | null = null;

  if (verified?.ok) {
    actorContext = {
      adminDb: verified.value.adminDb,
      userDoc: verified.value.userDoc,
    };
  } else {
    actorContext = await readCallbackActorFromCookie(decodeURIComponent(actorUidCookie || ""));
  }

  if (!actorContext) {
    const response = buildRedirect(origin, returnTo, "error");
    clearOauthCookies(response);
    return response;
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim() || "";
  const state = url.searchParams.get("state")?.trim() || "";
  const stateCookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STATE_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=") || "";
  const returnToCookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${RETURN_TO_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=") || DEFAULT_RETURN_TO;
  const redirectUriCookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REDIRECT_URI_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=") || "";

  const decodedReturnTo = decodeURIComponent(returnToCookie || DEFAULT_RETURN_TO);
  const redirectUri = decodeURIComponent(
    redirectUriCookie || new URL("/api/zoho/callback", resolveRequestOrigin(req)).toString(),
  );
  if (process.env.NODE_ENV !== "production") {
    try {
      console.log("[DEBUG] Zoho OAuth callback params:", {
        code,
        state,
        stateCookie,
        returnToCookie: decodedReturnTo,
        redirectUri,
      });
    } catch (e) {
      // ignore logging errors
    }
  }
  if (!code || !state || !stateCookie || state !== decodeURIComponent(stateCookie)) {
    const response = buildRedirect(origin, decodedReturnTo, "error");
    clearOauthCookies(response);
    return response;
  }

  try {
    await syncZohoMeetingConnectionFromCode(
      actorContext.adminDb,
      actorContext.userDoc,
      code,
      redirectUri,
    );
    const response = buildRedirect(origin, decodedReturnTo, "connected");
    clearOauthCookies(response);
    return response;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      try {
        console.error("[DEBUG] Zoho OAuth sync failed", {
          code,
          state,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          // attempt to capture payload if present
          payload: (err as any)?.payload ?? null,
        });
      } catch (e) {
        // ignore
      }
    }
    const response = buildRedirect(origin, decodedReturnTo, "error");
    clearOauthCookies(response);
    return response;
  }
}
