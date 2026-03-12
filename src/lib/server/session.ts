import "server-only";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { getAdmin } from "@/lib/firebase/admin";
import { SESSION_MAX_AGE_MS } from "@/lib/session";

export async function createSessionCookieFromIdToken(idToken: string) {
  const { adminAuth } = await getAdmin();
  await adminAuth.verifyIdToken(idToken);
  return adminAuth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
}

export async function verifySessionCookieValue(
  sessionCookie: string,
  options?: {
    adminAuth?: Auth;
    checkRevoked?: boolean;
  },
) {
  const adminAuth = options?.adminAuth ?? (await getAdmin()).adminAuth;
  return adminAuth.verifySessionCookie(sessionCookie, options?.checkRevoked ?? true);
}

export async function decodeSessionCookieValue(
  sessionCookie: string,
  options?: {
    adminAuth?: Auth;
  },
): Promise<DecodedIdToken | null> {
  try {
    return await verifySessionCookieValue(sessionCookie, {
      adminAuth: options?.adminAuth,
      checkRevoked: true,
    });
  } catch {
    return null;
  }
}
