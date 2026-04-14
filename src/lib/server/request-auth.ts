import { NextResponse } from "next/server";
import type { Auth } from "firebase-admin/auth";
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

export async function verifyBearerRequest(req: Request): Promise<VerificationResult> {
  const { adminAuth, adminDb } = await getAdmin();
  const authHeader = req.headers.get("Authorization");

  try {
    const decodedToken = authHeader?.startsWith("Bearer ")
      ? await adminAuth.verifyIdToken(authHeader.slice("Bearer ".length).trim())
      : await decodeSessionCookieValue(readCookieValue(req.headers.get("cookie")) ?? "", {
          adminAuth,
        });

    if (!decodedToken?.uid) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    const userSnap = await adminDb.collection("users").doc(decodedToken.uid).get();

    if (!userSnap.exists) {
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
        userDoc: {
          ...(userSnap.data() as UserDoc),
          uid: userSnap.id,
        },
      },
    };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid token" }, { status: 401 }),
    };
  }
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
