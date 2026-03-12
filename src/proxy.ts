import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isSessionCookieExpired, SESSION_COOKIE_NAME } from "@/lib/session";

const PROTECTED_PREFIXES = [
  "/admin",
  "/attendance",
  "/chat",
  "/crm",
  "/dashboard",
  "/employee",
  "/finance",
  "/hr",
  "/leads",
  "/manager",
  "/payroll",
  "/profile",
  "/reports",
  "/super-admin",
  "/tasks",
  "/team",
  "/team-lead",
];

function isProtected(req: NextRequest) {
  const { pathname } = req.nextUrl;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function proxy(req: NextRequest) {
  // Ignore Vite/internal requests to reduce log noise and unnecessary processing
  if (req.nextUrl.pathname.startsWith("/@vite")) {
    return NextResponse.next();
  }

  console.log("Proxy: Request", req.nextUrl.pathname);
  const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const hasSession = Boolean(sessionToken);
  const hasExpiredSession = sessionToken ? isSessionCookieExpired(sessionToken) : false;

  if (isProtected(req) && (!hasSession || hasExpiredSession)) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("expired", "1");
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    const res = NextResponse.redirect(url);
    if (hasExpiredSession) {
      res.cookies.delete(SESSION_COOKIE_NAME);
    }
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\.).*)"], // all routes except files with extensions
};
