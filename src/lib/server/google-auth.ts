import "server-only";

import type { Auth, DecodedIdToken, UserRecord } from "firebase-admin/auth";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  normalizeAuthProvider,
  normalizeEmailAddress,
} from "@/lib/auth/provider";
import type { UserDoc } from "@/lib/types/user";
import { getAdmin } from "@/lib/firebase/admin";

export class GoogleAuthError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GoogleAuthError";
    this.status = status;
  }
}

type ValidateGoogleAuthResult = {
  isNewUser: boolean;
  sessionToken: string;
  user: {
    uid: string;
    email: string;
    name: string | null;
    photoURL: string | null;
    googleId: string | null;
    authProvider: "google";
  };
};

function toLoginDate(decodedToken: DecodedIdToken) {
  if (typeof decodedToken.auth_time === "number") {
    return new Date(decodedToken.auth_time * 1000);
  }

  return new Date();
}

function getGoogleProvider(record: UserRecord) {
  return record.providerData.find((provider) => provider.providerId === "google.com") ?? null;
}

function getDisplayName(
  userRecord: UserRecord,
  decodedToken: DecodedIdToken,
  userDoc?: UserDoc | null,
) {
  const decodedName =
    typeof (decodedToken as Record<string, unknown>).name === "string"
      ? ((decodedToken as Record<string, unknown>).name as string)
      : null;

  return (
    userRecord.displayName ||
    decodedName ||
    userDoc?.displayName ||
    userDoc?.name ||
    null
  );
}

async function findUsersByEmail(adminDb: Firestore, email: string) {
  const snapshot = await adminDb
    .collection("users")
    .where("email", "==", email)
    .limit(3)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    data: { ...(doc.data() as UserDoc), uid: doc.id },
  }));
}

function resolveExistingUser(
  matches: Array<{ id: string; data: UserDoc }>,
  uid: string,
) {
  const current = matches.find((entry) => entry.id === uid) ?? null;
  const conflicts = matches.filter((entry) => entry.id !== uid);
  return { current, conflicts };
}

async function verifyGoogleFirebaseToken(adminAuth: Auth, idToken: string) {
  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    if (decodedToken.firebase.sign_in_provider !== "google.com") {
      throw new GoogleAuthError("Google authentication failed", 401);
    }

    return decodedToken;
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      throw error;
    }

    throw new GoogleAuthError("Google authentication failed", 401);
  }
}

export async function validateGoogleAuth(idToken: string): Promise<ValidateGoogleAuthResult> {
  const { adminAuth, adminDb } = await getAdmin();
  const decodedToken = await verifyGoogleFirebaseToken(adminAuth, idToken);
  const userRecord = await adminAuth.getUser(decodedToken.uid);
  const googleProvider = getGoogleProvider(userRecord);

  if (!googleProvider) {
    throw new GoogleAuthError("Google authentication failed", 401);
  }

  if (!decodedToken.email) {
    throw new GoogleAuthError("Google authentication failed", 401);
  }

  if (decodedToken.email_verified === false) {
    throw new GoogleAuthError("Google authentication failed", 401);
  }

  const normalizedEmail = normalizeEmailAddress(decodedToken.email);
  const matches = await findUsersByEmail(adminDb, normalizedEmail);
  const { current, conflicts } = resolveExistingUser(matches, userRecord.uid);

  const emailProviderConflict = conflicts.find(
    (entry) => normalizeAuthProvider(entry.data.authProvider) === "email",
  );

  if (emailProviderConflict) {
    throw new GoogleAuthError(
      "This account is registered with email/password. Please login using email and password.",
      409,
    );
  }

  if (conflicts.length > 0) {
    throw new GoogleAuthError(
      "We found another account profile with this email. Please contact support to complete Google sign-in.",
      409,
    );
  }

  if (current && normalizeAuthProvider(current.data.authProvider) === "email") {
    throw new GoogleAuthError(
      "This account is registered with email/password. Please login using email and password.",
      409,
    );
  }

  const now = FieldValue.serverTimestamp();
  const lastLogin = toLoginDate(decodedToken);
  const displayName = getDisplayName(userRecord, decodedToken, current?.data);
  const photoURL = userRecord.photoURL || current?.data.photoURL || null;
  const googleId = googleProvider.uid || current?.data.googleId || null;
  const userRef = adminDb.collection("users").doc(userRecord.uid);
  const isNewUser = !current;

  const nextUserDoc: Partial<UserDoc> = {
    uid: userRecord.uid,
    email: normalizedEmail,
    authProvider: "google",
    googleId,
    displayName,
    name: displayName,
    photoURL,
    phone: current?.data.phone ?? userRecord.phoneNumber ?? null,
    lastLogin,
    updatedAt: now,
  };

  if (!current) {
    nextUserDoc.role = "employee";
    nextUserDoc.status = "active";
    nextUserDoc.teamLeadId = null;
    nextUserDoc.orgRole = null;
    nextUserDoc.isActive = true;
    nextUserDoc.managerId = null;
    nextUserDoc.reportsTo = null;
    nextUserDoc.temporaryReportsTo = null;
    nextUserDoc.temporaryReportsToUntil = null;
    nextUserDoc.temporaryReportsToReason = null;
    nextUserDoc.actingManagerId = null;
    nextUserDoc.actingRole = null;
    nextUserDoc.actingOrgRole = null;
    nextUserDoc.actingRoleUntil = null;
    nextUserDoc.alternateEmail = null;
    nextUserDoc.alternatePhone = null;
    nextUserDoc.address = null;
    nextUserDoc.createdAt = now;
  }

  await userRef.set(nextUserDoc, { merge: true });

  return {
    isNewUser,
    sessionToken: idToken,
    user: {
      uid: userRecord.uid,
      email: normalizedEmail,
      name: displayName,
      photoURL,
      googleId,
      authProvider: "google",
    },
  };
}
