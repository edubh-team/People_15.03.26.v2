import { NextResponse } from "next/server";
import { buildSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    ...buildSessionCookieOptions(),
    maxAge: 0,
  });
  return res;
}
