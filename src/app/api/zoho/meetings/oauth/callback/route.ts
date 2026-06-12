import { NextResponse } from "next/server";
import { syncZohoMeetingConnectionFromCode } from "@/lib/server/meetings/service";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

const STATE_COOKIE = "zoho_meeting_oauth_state";
const RETURN_TO_COOKIE = "zoho_meeting_oauth_return_to";
const REDIRECT_URI_COOKIE = "zoho_meeting_oauth_redirect_uri";
const DEFAULT_RETURN_TO = "/crm/meetings/create";

function buildRedirect(requestUrl: string, returnTo: string, status: "connected" | "error") {
  const target = new URL(returnTo, requestUrl);
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
}

export async function GET(req: Request) {
  const verified = await verifyBearerRequest(req);
  const requestUrl = new URL(req.url);
  if (process.env.NODE_ENV !== "production") {
    try {
      // Temporary debug logging to help diagnose missing session cookie on OAuth redirect.
      // Logs will appear in the dev server console and should be removed after debugging.
      // eslint-disable-next-line no-console
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

  if (!verified.ok) {
    const response = buildRedirect(req.url, returnTo, "error");
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
  const redirectUri = decodeURIComponent(redirectUriCookie || new URL("/api/zoho/callback", req.url).toString());
  if (process.env.NODE_ENV !== "production") {
    try {
      // eslint-disable-next-line no-console
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
    const response = buildRedirect(req.url, decodedReturnTo, "error");
    clearOauthCookies(response);
    return response;
  }

  try {
    await syncZohoMeetingConnectionFromCode(
      verified.value.adminDb,
      verified.value.userDoc,
      code,
      redirectUri,
    );
    const response = buildRedirect(req.url, decodedReturnTo, "connected");
    clearOauthCookies(response);
    return response;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      try {
        // eslint-disable-next-line no-console
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
    const response = buildRedirect(req.url, decodedReturnTo, "error");
    clearOauthCookies(response);
    return response;
  }
}
