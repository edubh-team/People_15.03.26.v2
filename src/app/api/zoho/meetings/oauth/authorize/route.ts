import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { verifyBearerRequest } from "@/lib/server/request-auth";
import { createZohoMeetingAuthorizationUrl } from "@/lib/server/meetings/zoho";

export const runtime = "nodejs";

const STATE_COOKIE = "zoho_meeting_oauth_state";
const RETURN_TO_COOKIE = "zoho_meeting_oauth_return_to";
const REDIRECT_URI_COOKIE = "zoho_meeting_oauth_redirect_uri";
const ACTOR_UID_COOKIE = "zoho_meeting_oauth_actor_uid";
const DEFAULT_RETURN_TO = "/crm/meetings/create";

function buildReturnRedirect(origin: string, returnTo: string) {
  const target = new URL(returnTo || DEFAULT_RETURN_TO, origin);
  target.searchParams.set("zoho", "error");
  return NextResponse.redirect(target);
}

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

function applyOauthCookies(
  response: NextResponse,
  input: {
    state: string;
    returnTo: string;
    redirectUri: string;
    actorUid: string;
  },
) {
  response.cookies.set(STATE_COOKIE, input.state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  response.cookies.set(RETURN_TO_COOKIE, input.returnTo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  response.cookies.set(REDIRECT_URI_COOKIE, input.redirectUri, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  response.cookies.set(ACTOR_UID_COOKIE, input.actorUid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
}

function readReturnToFromRequest(fallbackSearchParams: URLSearchParams) {
  const queryValue = fallbackSearchParams.get("returnTo")?.trim();
  if (queryValue) return queryValue;
  return DEFAULT_RETURN_TO;
}

async function buildOauthStart(req: Request) {
  const origin = resolveRequestOrigin(req);
  const url = new URL(req.url);
  const returnTo = readReturnToFromRequest(url.searchParams);
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) {
    return { ok: false as const, origin, returnTo };
  }

  const state = randomUUID();
  const redirectUri = new URL("/api/zoho/callback", origin).toString();
  const authorizationUrl = createZohoMeetingAuthorizationUrl(state, redirectUri);

  return {
    ok: true as const,
    origin,
    returnTo,
    actorUid: verified.value.uid,
    state,
    redirectUri,
    authorizationUrl,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const returnTo = url.searchParams.get("returnTo")?.trim() || DEFAULT_RETURN_TO;
  const origin = resolveRequestOrigin(req);

  try {
    const started = await buildOauthStart(req);
    if (!started.ok) {
      return buildReturnRedirect(origin, returnTo);
    }

    const response = NextResponse.redirect(started.authorizationUrl);
    applyOauthCookies(response, {
      state: started.state,
      returnTo: started.returnTo,
      redirectUri: started.redirectUri,
      actorUid: started.actorUid,
    });
    return response;
  } catch (error) {
    console.error("[ZOHO_AUTHORIZE_ROUTE_ERROR]", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestUrl: req.url,
      returnTo,
      resolvedOrigin: origin,
      forwardedProto: req.headers.get("x-forwarded-proto"),
      forwardedHost: req.headers.get("x-forwarded-host"),
      host: req.headers.get("host"),
    });
    return buildReturnRedirect(origin, returnTo);
  }
}

export async function POST(req: Request) {
  const origin = resolveRequestOrigin(req);

  try {
    const body = await req.json().catch(() => ({})) as { returnTo?: unknown };
    const requestUrl = new URL(req.url);
    if (typeof body.returnTo === "string" && body.returnTo.trim()) {
      requestUrl.searchParams.set("returnTo", body.returnTo.trim());
    }
    const requestWithQuery = new Request(requestUrl.toString(), {
      method: req.method,
      headers: req.headers,
    });
    const started = await buildOauthStart(requestWithQuery);
    if (!started.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const response = NextResponse.json({ url: started.authorizationUrl });
    applyOauthCookies(response, {
      state: started.state,
      returnTo: started.returnTo,
      redirectUri: started.redirectUri,
      actorUid: started.actorUid,
    });
    return response;
  } catch (error) {
    console.error("[ZOHO_AUTHORIZE_POST_ERROR]", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestUrl: req.url,
      resolvedOrigin: origin,
      forwardedProto: req.headers.get("x-forwarded-proto"),
      forwardedHost: req.headers.get("x-forwarded-host"),
      host: req.headers.get("host"),
    });
    return NextResponse.json({ error: "Unable to start Zoho OAuth." }, { status: 500 });
  }
}
