import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { verifyBearerRequest } from "@/lib/server/request-auth";
import { createZohoMeetingAuthorizationUrl } from "@/lib/server/meetings/zoho";

export const runtime = "nodejs";

const STATE_COOKIE = "zoho_meeting_oauth_state";
const RETURN_TO_COOKIE = "zoho_meeting_oauth_return_to";
const REDIRECT_URI_COOKIE = "zoho_meeting_oauth_redirect_uri";
const DEFAULT_RETURN_TO = "/crm/meetings/create";

function buildReturnRedirect(requestUrl: string, returnTo: string) {
  const target = new URL(returnTo || DEFAULT_RETURN_TO, requestUrl);
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const returnTo = url.searchParams.get("returnTo")?.trim() || DEFAULT_RETURN_TO;

  try {
    const verified = await verifyBearerRequest(req);
    if (!verified.ok) {
      return buildReturnRedirect(req.url, returnTo);
    }

    const state = randomUUID();
    const redirectUri = new URL("/api/zoho/callback", resolveRequestOrigin(req)).toString();

    const response = NextResponse.redirect(createZohoMeetingAuthorizationUrl(state, redirectUri));
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    response.cookies.set(RETURN_TO_COOKIE, returnTo, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    response.cookies.set(REDIRECT_URI_COOKIE, redirectUri, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    return response;
  } catch (error) {
    console.error("[ZOHO_AUTHORIZE_ROUTE_ERROR]", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestUrl: req.url,
      returnTo,
      forwardedProto: req.headers.get("x-forwarded-proto"),
      forwardedHost: req.headers.get("x-forwarded-host"),
      host: req.headers.get("host"),
    });
    return buildReturnRedirect(req.url, returnTo);
  }
}
