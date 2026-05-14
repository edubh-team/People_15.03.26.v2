import { NextResponse } from "next/server";
import { buildSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session";
import { createSessionCookieFromIdToken } from "@/lib/server/session";
import { GoogleAuthError, validateGoogleAuth } from "@/lib/server/google-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";

  if (!idToken || idToken.length < 10) {
    return NextResponse.json(
      { ok: false, error: "Google authentication failed" },
      { status: 400 },
    );
  }

  try {
    const result = await validateGoogleAuth(idToken);
    const sessionCookie = await createSessionCookieFromIdToken(result.sessionToken);
    const response = NextResponse.json({
      ok: true,
      isNewUser: result.isNewUser,
      user: result.user,
    });

    response.cookies.set(
      SESSION_COOKIE_NAME,
      sessionCookie,
      buildSessionCookieOptions(),
    );

    return response;
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }

    console.error("POST /api/auth/google failed", error);
    return NextResponse.json(
      { ok: false, error: "Google authentication failed" },
      { status: 500 },
    );
  }
}
