import { NextResponse } from "next/server";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { canAccessFinance, canCreateUsers, canManageTeam, isAdminUser, isHrUser } from "@/lib/access";
import { getAdmin } from "@/lib/firebase/admin";
import { readCookieValue } from "@/lib/session";
import { decodeSessionCookieValue } from "@/lib/server/session";
import type { UserDoc } from "@/lib/types/user";

export type VerifiedRequestUser = {
  adminAuth: Auth;
  adminDb: Firestore;
  uid: string;
  userDoc: UserDoc;
};

type VerificationResult =
  | { ok: true; value: VerifiedRequestUser }
  | { ok: false; response: NextResponse };

type UserDocCacheEntry = {
  userDoc: UserDoc;
  expiresAt: number;
};

type DecodedTokenCacheEntry = {
  decodedToken: DecodedIdToken | null;
  expiresAt: number;
};

const USER_DOC_CACHE_TTL_MS = 1000 * 60 * 5;
const STALE_USER_DOC_CACHE_TTL_MS = 1000 * 60 * 60;
const DECODED_TOKEN_CACHE_TTL_MS = 1000 * 60;
const userDocCache = new Map<string, UserDocCacheEntry>();
const pendingUserDocReads = new Map<string, Promise<UserDoc | null>>();
const decodedTokenCache = new Map<string, DecodedTokenCacheEntry>();

function readDecodedTokenCache(cacheKey: string) {
  const cached = decodedTokenCache.get(cacheKey);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    decodedTokenCache.delete(cacheKey);
    return undefined;
  }
  return cached.decodedToken;
}

function writeDecodedTokenCache(cacheKey: string, decodedToken: DecodedIdToken | null) {
  decodedTokenCache.set(cacheKey, {
    decodedToken,
    expiresAt: Date.now() + DECODED_TOKEN_CACHE_TTL_MS,
  });
}

function getFirebaseErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code);
  }
  return "";
}

async function getRequestUserDoc(adminDb: Firestore, uid: string) {
  const now = Date.now();
  const cached = userDocCache.get(uid);
  if (cached && cached.expiresAt > now) {
    return cached.userDoc;
  }

  const existingRead = pendingUserDocReads.get(uid);
  if (existingRead) {
    return existingRead;
  }

  const readPromise = adminDb
    .collection("users")
    .doc(uid)
    .get()
    .then((userSnap) => {
      if (!userSnap.exists) return null;

      const userDoc = {
        ...(userSnap.data() as UserDoc),
        uid: userSnap.id,
      };
      userDocCache.set(uid, {
        userDoc,
        expiresAt: Date.now() + USER_DOC_CACHE_TTL_MS,
      });
      return userDoc;
    })
    .catch((error) => {
      const staleCached = userDocCache.get(uid);
      if (
        staleCached &&
        staleCached.expiresAt + STALE_USER_DOC_CACHE_TTL_MS > Date.now() &&
        getFirebaseErrorCode(error) === "8"
      ) {
        return staleCached.userDoc;
      }
      throw error;
    })
    .finally(() => {
      pendingUserDocReads.delete(uid);
    });

  pendingUserDocReads.set(uid, readPromise);
  return readPromise;
}

async function decodeRequestToken(
  req: Request,
  adminAuth: Auth,
): Promise<{ decodedToken: DecodedIdToken | null; invalidBearer: boolean }> {
  const sessionCookie = readCookieValue(req.headers.get("cookie")) ?? "";
  if (sessionCookie) {
    const cacheKey = `session:${sessionCookie}`;
    const cachedToken = readDecodedTokenCache(cacheKey);
    if (typeof cachedToken !== "undefined") {
      return { decodedToken: cachedToken, invalidBearer: false };
    }

    const decodedSession = await decodeSessionCookieValue(sessionCookie, {
      adminAuth,
      checkRevoked: false,
    });
    writeDecodedTokenCache(cacheKey, decodedSession);
    if (decodedSession?.uid) {
      return { decodedToken: decodedSession, invalidBearer: false };
    }
  }

  const authHeader = req.headers.get("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  let invalidBearer = false;

  if (bearerToken) {
    const cacheKey = `bearer:${bearerToken}`;
    const cachedToken = readDecodedTokenCache(cacheKey);
    if (typeof cachedToken !== "undefined") {
      return { decodedToken: cachedToken, invalidBearer: cachedToken === null };
    }

    try {
      const decodedToken = await adminAuth.verifyIdToken(bearerToken);
      writeDecodedTokenCache(cacheKey, decodedToken);
      return {
        decodedToken,
        invalidBearer,
      };
    } catch {
      writeDecodedTokenCache(cacheKey, null);
      invalidBearer = true;
    }
  }

  return { decodedToken: null, invalidBearer };
}

export async function verifyBearerRequest(req: Request): Promise<VerificationResult> {
  const { adminAuth, adminDb } = await getAdmin();
  const { decodedToken, invalidBearer } = await decodeRequestToken(req, adminAuth);

  if (!decodedToken?.uid) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: invalidBearer ? "Invalid token" : "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  let userDoc: UserDoc | null;
  try {
    userDoc = await getRequestUserDoc(adminDb, decodedToken.uid);
  } catch (error) {
    if (getFirebaseErrorCode(error) === "8") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Firebase quota exceeded while loading your profile. Please retry shortly." },
          { status: 503 },
        ),
      };
    }
    throw error;
  }

  if (!userDoc) {
    return {
      ok: false,
      response: NextResponse.json({ error: "User profile not found" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    value: {
      adminAuth,
      adminDb,
      uid: decodedToken.uid,
      userDoc,
    },
  };
}

export async function requireFinanceRequestUser(req: Request): Promise<VerificationResult> {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified;

  if (!canAccessFinance(verified.value.userDoc)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: Finance access only" },
        { status: 403 },
      ),
    };
  }

  return verified;
}

export async function requireTeamManagementRequestUser(
  req: Request,
): Promise<VerificationResult> {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified;

  if (!canManageTeam(verified.value.userDoc)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: Team leadership access only" },
        { status: 403 },
      ),
    };
  }

  return verified;
}

export async function requireUserCreationRequestUser(
  req: Request,
): Promise<VerificationResult> {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified;

  if (!canCreateUsers(verified.value.userDoc)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: User creation access only" },
        { status: 403 },
      ),
    };
  }

  return verified;
}

export async function requirePayrollRequestUser(req: Request): Promise<VerificationResult> {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified;

  if (!isHrUser(verified.value.userDoc) && !isAdminUser(verified.value.userDoc)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: Payroll access only" },
        { status: 403 },
      ),
    };
  }

  return verified;
}
