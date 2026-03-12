import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "./client";
import type { UserDoc } from "@/lib/types/user";
import { canUserOperate } from "@/lib/people/lifecycle";

export async function getUserDoc(uid: string) {
  if (!db) throw new Error("Firebase is not configured");
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { ...(snap.data() as UserDoc) };
}

export async function getUserByEmail(email: string) {
  if (!db) throw new Error("Firebase is not configured");
  const normalized = email.trim().toLowerCase();
  const q = query(collection(db, "users"), where("email", "==", normalized), limit(1));
  const snap = await getDocs(q);
  const docSnap = snap.docs[0];
  if (!docSnap) return null;
  return { ...(docSnap.data() as UserDoc) };
}

export async function ensureUserDoc(
  user: User,
  options?: { requireEmployeeAccess?: boolean },
) {
  if (!db) throw new Error("Firebase is not configured");
  const requiresAccess = Boolean(options?.requireEmployeeAccess);

  const access = requiresAccess && user.email ? await getUserByEmail(user.email) : null;

  if (requiresAccess) {
    if (!access) throw new Error("Unauthorized");
    if (!canUserOperate(access)) throw new Error("Unauthorized");
  }

  const existing = await getUserDoc(user.uid);
  if (existing) {
    if (requiresAccess && access) {
      await updateUserDoc(user.uid, {
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
      });
      const updated = await getUserDoc(user.uid);
      return updated ?? existing;
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
  return next;
}

export async function updateUserDoc(uid: string, patch: Partial<UserDoc>) {
  if (!db) throw new Error("Firebase is not configured");
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function upsertUserDoc(uid: string, patch: Partial<UserDoc>) {
  if (!db) throw new Error("Firebase is not configured");
  const ref = doc(db, "users", uid);
  await setDoc(
    ref,
    {
      ...patch,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
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
