import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "./client";
import type { UserDoc } from "@/lib/types/user";
import { canUserOperate } from "@/lib/people/lifecycle";

type CachedUserDocEntry = {
  userDoc: UserDoc | null;
  expiresAt: number;
};

const USER_DOC_CACHE_TTL_MS = 1000 * 60 * 5;
const userDocCache = new Map<string, CachedUserDocEntry>();
const userEmailCache = new Map<string, CachedUserDocEntry>();
const pendingUserDocReads = new Map<string, Promise<UserDoc | null>>();
const pendingUserEmailReads = new Map<string, Promise<UserDoc | null>>();

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function readCachedUser(cache: Map<string, CachedUserDocEntry>, key: string) {
  const cached = cache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return cached.userDoc;
}

function primeUserCache(userDoc: UserDoc | null) {
  if (!userDoc?.uid) return;

  const cacheEntry: CachedUserDocEntry = {
    userDoc,
    expiresAt: Date.now() + USER_DOC_CACHE_TTL_MS,
  };

  userDocCache.set(userDoc.uid, cacheEntry);

  if (userDoc.email) {
    userEmailCache.set(normalizeEmail(userDoc.email), cacheEntry);
  }
}

function cacheMissingUser(uid: string) {
  userDocCache.set(uid, {
    userDoc: null,
    expiresAt: Date.now() + USER_DOC_CACHE_TTL_MS,
  });
}

function invalidateUserCache(uid: string, email?: string | null) {
  userDocCache.delete(uid);
  if (email) {
    userEmailCache.delete(normalizeEmail(email));
  }

  for (const [cacheKey, cached] of userEmailCache.entries()) {
    if (cached.userDoc?.uid === uid) {
      userEmailCache.delete(cacheKey);
    }
  }
}

export async function getUserDoc(uid: string) {
  if (!db) throw new Error("Firebase is not configured");
  const cached = readCachedUser(userDocCache, uid);
  if (typeof cached !== "undefined") return cached;

  const pending = pendingUserDocReads.get(uid);
  if (pending) return pending;

  const ref = doc(db, "users", uid);
  const readPromise = getDoc(ref)
    .then((snap) => {
      if (!snap.exists()) {
        cacheMissingUser(uid);
        return null;
      }

      const userDoc = { ...(snap.data() as UserDoc), uid: snap.id };
      primeUserCache(userDoc);
      return userDoc;
    })
    .finally(() => {
      pendingUserDocReads.delete(uid);
    });

  pendingUserDocReads.set(uid, readPromise);
  return readPromise;
}

export async function getUserByEmail(email: string) {
  if (!db) throw new Error("Firebase is not configured");
  const normalized = normalizeEmail(email);
  const cached = readCachedUser(userEmailCache, normalized);
  if (typeof cached !== "undefined") return cached;

  const pending = pendingUserEmailReads.get(normalized);
  if (pending) return pending;

  const q = query(collection(db, "users"), where("email", "==", normalized), limit(1));
  const readPromise = getDocs(q)
    .then((snap) => {
      const docSnap = snap.docs[0];
      if (!docSnap) return null;

      const userDoc = { ...(docSnap.data() as UserDoc), uid: docSnap.id };
      primeUserCache(userDoc);
      return userDoc;
    })
    .finally(() => {
      pendingUserEmailReads.delete(normalized);
    });

  pendingUserEmailReads.set(normalized, readPromise);
  return readPromise;
}

export async function ensureUserDoc(
  user: User,
  options?: { requireEmployeeAccess?: boolean },
) {
  if (!db) throw new Error("Firebase is not configured");
  const requiresAccess = Boolean(options?.requireEmployeeAccess);
  const existing = await getUserDoc(user.uid);

  const access =
    requiresAccess && user.email
      ? await getUserByEmail(user.email)
      : null;

  if (requiresAccess) {
    if (!access) throw new Error("Unauthorized");
    if (!canUserOperate(access)) throw new Error("Unauthorized");
  }

  if (existing) {
    if (requiresAccess && access) {
      const patch: Partial<UserDoc> = {
        email: user.email ?? existing.email,
        displayName: user.displayName ?? existing.displayName,
        phone: user.phoneNumber ?? existing.phone,
        photoURL: existing.photoURL ?? user.photoURL ?? null,
        role: existing.role,
        status: existing.status,
        teamLeadId: existing.teamLeadId,
        reportsTo: existing.reportsTo ?? existing.teamLeadId ?? access.managerId ?? null,
        temporaryReportsTo: existing.temporaryReportsTo ?? null,
        temporaryReportsToUntil: existing.temporaryReportsToUntil ?? null,
        temporaryReportsToReason: existing.temporaryReportsToReason ?? null,
        orgRole: access.orgRole ?? null,
        isActive: access.isActive ?? true,
        managerId: access.managerId ?? null,
        actingManagerId: existing.actingManagerId ?? null,
        actingRole: existing.actingRole ?? null,
        actingOrgRole: existing.actingOrgRole ?? null,
        actingRoleUntil: existing.actingRoleUntil ?? null,
      };
      await updateUserDoc(user.uid, patch);
      const updated = {
        ...existing,
        ...patch,
      };
      primeUserCache(updated);
      return updated;
    }
    return existing;
  }

  const ref = doc(db, "users", user.uid);
  const next: UserDoc = {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    phone: user.phoneNumber ?? null,
    alternateEmail: null,
    alternatePhone: null,
    address: null,
    role: "employee",
    status: "active",
    teamLeadId: null,
    reportsTo: null,
    temporaryReportsTo: null,
    temporaryReportsToUntil: null,
    temporaryReportsToReason: null,
    orgRole: access?.orgRole ?? null,
    isActive: access?.isActive ?? true,
    managerId: access?.managerId ?? null,
    actingManagerId: null,
    actingRole: null,
    actingOrgRole: null,
    actingRoleUntil: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, next, { merge: true });
  primeUserCache(next);
  return next;
}

export async function updateUserDoc(uid: string, patch: Partial<UserDoc>) {
  if (!db) throw new Error("Firebase is not configured");
  const ref = doc(db, "users", uid);
  const existing = readCachedUser(userDocCache, uid);
  await updateDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
  });
  invalidateUserCache(uid, patch.email ?? existing?.email ?? null);
}

export async function upsertUserDoc(uid: string, patch: Partial<UserDoc>) {
  if (!db) throw new Error("Firebase is not configured");
  const ref = doc(db, "users", uid);
  const existing = readCachedUser(userDocCache, uid);
  await setDoc(
    ref,
    {
      ...patch,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  invalidateUserCache(uid, patch.email ?? existing?.email ?? null);
}

export async function getActiveEmployeesByManager(managerId: string) {
  if (!db) throw new Error("Firebase is not configured");
  const q = query(
    collection(db, "users"),
    where("teamLeadId", "==", managerId),
    where("status", "==", "active"),
    where("role", "==", "employee"),
    limit(500),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as UserDoc);
}

export async function getAllActiveUsers() {
  if (!db) throw new Error("Firebase is not configured");
  const q = query(
    collection(db, "users"),
    where("status", "==", "active"),
    limit(1000)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as UserDoc);
}
