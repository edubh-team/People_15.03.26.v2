export const SESSION_COOKIE_NAME = "session_token";
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 5;
export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_MAX_AGE_MS / 1000);

export function buildSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function readCookieValue(
  cookieHeader: string | null | undefined,
  cookieName = SESSION_COOKIE_NAME,
) {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...valueParts] = part.trim().split("=");
    if (rawName !== cookieName) continue;

    const value = valueParts.join("=");
    if (!value) return null;

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

function decodeBase64Url(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  if (typeof atob === "function") {
    return atob(padded);
  }

  return Buffer.from(padded, "base64").toString("utf8");
}

export function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    return JSON.parse(decodeBase64Url(payload)) as { exp?: number };
  } catch {
    return null;
  }
}

export function isSessionCookieExpired(token: string) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 <= Date.now();
}
