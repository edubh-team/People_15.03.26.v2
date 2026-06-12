import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { verifyBearerRequest } from "@/lib/server/request-auth";
import { createZohoMeetingAuthorizationUrl } from "@/lib/server/meetings/zoho";

export const runtime = "nodejs";

const STATE_COOKIE = "zoho_meeting_oauth_state";
const RETURN_TO_COOKIE = "zoho_meeting_oauth_return_to";
const DEFAULT_RETURN_TO = "/crm/meetings/create";

export async function GET(req: Request) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  const url = new URL(req.url);
  const returnTo = url.searchParams.get("returnTo")?.trim() || DEFAULT_RETURN_TO;
  const state = randomUUID();

  const response = NextResponse.redirect(createZohoMeetingAuthorizationUrl(state));
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
  return response;
}
