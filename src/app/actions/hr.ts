
"use server";

import { getAdmin } from "@/lib/firebase/admin";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  buildMonthlyApprovedLeaveSummaryByUser,
  calculateMonthlyLeaveDeduction,
} from "@/lib/attendance/leave-policy";
import { Payroll } from "@/lib/types/hr";
import { sendEmail } from "@/lib/email";
import { isClosedLeadStatus } from "@/lib/leads/status";
import { buildCounsellingEntryCycleMeta, dateKeyToDate, toDateKey } from "@/lib/sales/counselling";
import { getEffectiveReportsToUid, getSalesHierarchyRank } from "@/lib/sales/hierarchy";
import type { LeadDoc, LeadTimelineActor, LeadTransferRecord } from "@/lib/types/crm";
import type { CounsellingReviewStatus, PipFailureAction } from "@/lib/types/performance";
import type { UserDoc } from "@/lib/types/user";

// ... existing imports ...
// UserRole is removed as it's unused

type EmployeeLifecycleAction = "deactivate" | "inactive_till" | "terminate" | "reactivate";

type UpdateEmployeeLifecycleInput = {
  targetUid: string;
  action: EmployeeLifecycleAction;
  reason: string;
  callerIdToken: string;
  inactiveUntil?: string | Date | null;
};

type LifecycleActionResult = {
  success: boolean;
  error?: string;
  message?: string;
  transferredLeads?: number;
  transferredLeadIds?: string[];
  targetStatus?: string;
};

type PIPFailureDecisionInput = {
  pipCaseId: string;
  targetUid: string;
  decision: PipFailureAction;
  reason: string;
  callerIdToken: string;
  extensionDays?: number | null;
  inactiveUntil?: string | Date | null;
};

type CounsellingEntryInput = {
  callerIdToken: string;
  entryDateKey?: string | null;
  counsellingCount: number;
  notes?: string | null;
};

type CounsellingReviewInput = {
  callerIdToken: string;
  entryId: string;
  status: Exclude<CounsellingReviewStatus, "pending">;
  reason?: string | null;
};

type QualifyBdaTraineeInput = {
  callerIdToken: string;
  targetUid: string;
  reason?: string | null;
};

const BDA_TRAINEE_REQUIRED_SALES = 1;
const BDA_TRAINEE_WINDOW_DAYS = 15;

type LifecycleActor = {
  uid: string;
  name: string | null;
  role: string | null;
  employeeId: string | null;
};

function normalizeRoleToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

function isExecutiveRole(user: Pick<UserDoc, "role" | "orgRole"> | null | undefined) {
  const role = normalizeRoleToken(user?.role);
  const orgRole = normalizeRoleToken(user?.orgRole);
  return role === "SUPER_ADMIN" || role === "ADMIN" || orgRole === "SUPER_ADMIN" || orgRole === "ADMIN";
}

function isHrRole(user: Pick<UserDoc, "role" | "orgRole"> | null | undefined) {
  const role = normalizeRoleToken(user?.role);
  const orgRole = normalizeRoleToken(user?.orgRole);
  return role === "HR" || orgRole === "HR";
}

function isManagerOrAboveRole(user: Pick<UserDoc, "role" | "orgRole"> | null | undefined) {
  return getSalesHierarchyRank({
    role: user?.role ?? null,
    orgRole: user?.orgRole ?? null,
  }) >= getSalesHierarchyRank("MANAGER");
}

function isSeniorManagerOrAboveRole(user: Pick<UserDoc, "role" | "orgRole"> | null | undefined) {
  return getSalesHierarchyRank({
    role: user?.role ?? null,
    orgRole: user?.orgRole ?? null,
  }) >= getSalesHierarchyRank("SENIOR_MANAGER");
}

function isBdaRole(user: Pick<UserDoc, "role" | "orgRole"> | null | undefined) {
  const role = normalizeRoleToken(user?.role);
  const orgRole = normalizeRoleToken(user?.orgRole);
  return role === "BDA" || orgRole === "BDA";
}

function isBdaTraineeRole(user: Pick<UserDoc, "role" | "orgRole"> | null | undefined) {
  const role = normalizeRoleToken(user?.role);
  const orgRole = normalizeRoleToken(user?.orgRole);
  return (
    role === "BDA_TRAINEE" ||
    orgRole === "BDA_TRAINEE" ||
    role === "BDAT" ||
    orgRole === "BDAT"
  );
}

function canManageEmployeeLifecycle(user: Pick<UserDoc, "role" | "orgRole"> | null | undefined) {
  return isExecutiveRole(user) || isHrRole(user) || isManagerOrAboveRole(user);
}

function toDateOrNull(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value && "seconds" in value && typeof (value as { seconds?: unknown }).seconds === "number") {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeUserStatus(status: unknown) {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "terminated") return "terminated";
  if (normalized === "inactive") return "inactive";
  return "active";
}

function buildLifecycleActor(user: Pick<UserDoc, "uid" | "displayName" | "email" | "role" | "orgRole" | "employeeId">): LifecycleActor {
  return {
    uid: user.uid,
    name: user.displayName ?? user.email ?? user.uid,
    role: (user.orgRole ?? user.role ?? null) as string | null,
    employeeId: user.employeeId ?? null,
  };
}

async function canManageLifecycleTarget(input: {
  adminDb: Firestore;
  caller: UserDoc;
  targetUid: string;
}) {
  if (isExecutiveRole(input.caller) || isHrRole(input.caller)) {
    return true;
  }
  if (!isManagerOrAboveRole(input.caller)) {
    return false;
  }
  if (input.caller.uid === input.targetUid) {
    return false;
  }

  const usersSnap = await input.adminDb.collection("users").limit(3000).get();
  const usersByUid = new Map<string, UserDoc>();
  usersSnap.docs.forEach((row) => {
    usersByUid.set(row.id, { ...(row.data() as UserDoc), uid: row.id });
  });

  const visited = new Set<string>();
  let cursorUid: string | null = input.targetUid;
  while (cursorUid && !visited.has(cursorUid)) {
    if (cursorUid === input.caller.uid) return true;
    visited.add(cursorUid);

    const cursor = usersByUid.get(cursorUid);
    if (!cursor) break;
    cursorUid = getEffectiveReportsToUid(cursor);
  }

  return false;
}

function buildTransferRecordId(leadId: string) {
  return `${leadId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function transferActiveLeadsToManager(input: {
  adminDb: Firestore;
  targetUser: UserDoc;
  managerUser: UserDoc;
  actor: LifecycleActor;
  reason: string;
  action: EmployeeLifecycleAction;
}) {
  const ownerSnap = await input.adminDb
    .collection("leads")
    .where("ownerUid", "==", input.targetUser.uid)
    .limit(3000)
    .get();
  const assignedSnap = await input.adminDb
    .collection("leads")
    .where("assignedTo", "==", input.targetUser.uid)
    .limit(3000)
    .get();

  const leadDocs = new Map<string, (typeof ownerSnap.docs)[number]>();
  ownerSnap.docs.forEach((row) => leadDocs.set(row.id, row));
  assignedSnap.docs.forEach((row) => leadDocs.set(row.id, row));

  const now = new Date();
  let batch = input.adminDb.batch();
  let writes = 0;
  let transferred = 0;
  const transferredLeadIds: string[] = [];

  const commit = async () => {
    if (writes === 0) return;
    await batch.commit();
    batch = input.adminDb.batch();
    writes = 0;
  };

  for (const row of leadDocs.values()) {
    const lead = { ...(row.data() as LeadDoc), leadId: row.id };
    if (isClosedLeadStatus(lead.status)) continue;
    if (lead.mergeState === "merged") continue;
    if (lead.ownerUid === input.managerUser.uid && lead.assignedTo === input.managerUser.uid) continue;

    const previousOwnerUid = lead.ownerUid ?? lead.assignedTo ?? null;
    const transferRecord: LeadTransferRecord = {
      id: buildTransferRecordId(lead.leadId),
      custodyState: "reassigned",
      reason: input.reason,
      previousOwnerUid,
      previousOwnerName: input.targetUser.displayName ?? input.targetUser.email ?? input.targetUser.uid,
      currentOwnerUid: input.managerUser.uid,
      currentOwnerName: input.managerUser.displayName ?? input.managerUser.email ?? input.managerUser.uid,
      transferredBy: {
        uid: input.actor.uid,
        name: input.actor.name,
        role: input.actor.role,
        employeeId: input.actor.employeeId,
      },
      transferredAt: now,
    };

    batch.update(row.ref, {
      assignedTo: input.managerUser.uid,
      ownerUid: input.managerUser.uid,
      assignedBy: input.actor.uid,
      assignedAt: now,
      custodyState: "reassigned",
      custodyReason: input.reason,
      custodyUpdatedAt: now,
      lastTransfer: transferRecord,
      transferHistory: FieldValue.arrayUnion(transferRecord),
      history: FieldValue.arrayUnion({
        action: "Employee Lifecycle Transfer",
        oldStatus: previousOwnerUid ?? "Pool",
        newStatus: input.managerUser.displayName ?? input.managerUser.uid,
        remarks: input.reason,
        updatedBy: input.actor.uid,
        updatedByName: input.actor.name ?? undefined,
        timestamp: now,
      }),
      updatedAt: now,
      lastActionBy: input.actor.uid,
      lastActionAt: now,
    });
    writes += 1;

    const timelineRef = row.ref.collection("timeline").doc();
    const timelineActor: LeadTimelineActor = {
      uid: input.actor.uid,
      name: input.actor.name,
      role: input.actor.role,
      employeeId: input.actor.employeeId,
    };
    batch.set(timelineRef, {
      type: "reassigned",
      summary: `Lead reassigned to ${input.managerUser.displayName ?? input.managerUser.uid} because employee is ${input.action.replace("_", " ")}`,
      actor: timelineActor,
      metadata: {
        transferId: transferRecord.id,
        reason: transferRecord.reason,
        custodyState: transferRecord.custodyState,
        previousOwnerUid: transferRecord.previousOwnerUid,
        previousOwnerName: transferRecord.previousOwnerName ?? null,
        currentOwnerUid: transferRecord.currentOwnerUid,
        currentOwnerName: transferRecord.currentOwnerName ?? null,
        lifecycleAction: input.action,
      },
      createdAt: now,
    });
    writes += 1;

    transferred += 1;
    transferredLeadIds.push(lead.leadId);

    if (writes >= 380) {
      await commit();
    }
  }

  await commit();
  return { transferred, transferredLeadIds, scanned: leadDocs.size };
}

export async function updateEmployeeLifecycle(input: UpdateEmployeeLifecycleInput): Promise<LifecycleActionResult> {
  try {
    const { adminAuth, adminDb } = await getAdmin();
    const decodedToken = await adminAuth.verifyIdToken(input.callerIdToken);
    const callerUid = decodedToken.uid;

    const [callerSnap, targetSnap] = await Promise.all([
      adminDb.collection("users").doc(callerUid).get(),
      adminDb.collection("users").doc(input.targetUid).get(),
    ]);

    if (!callerSnap.exists) {
      throw new Error("Caller profile not found.");
    }
    if (!targetSnap.exists) {
      throw new Error("Target employee not found.");
    }

    const caller = { ...(callerSnap.data() as UserDoc), uid: callerSnap.id };
    const targetUser = { ...(targetSnap.data() as UserDoc), uid: targetSnap.id };

    if (caller.uid === targetUser.uid) {
      throw new Error("You cannot apply lifecycle actions on your own account.");
    }
    if (isExecutiveRole(targetUser)) {
      throw new Error("Lifecycle actions are not allowed on executive control accounts.");
    }

    if (!canManageEmployeeLifecycle(caller)) {
      throw new Error("Unauthorized: manager+ or HR access required.");
    }
    const inScope = await canManageLifecycleTarget({
      adminDb,
      caller,
      targetUid: targetUser.uid,
    });
    if (!inScope) {
      throw new Error("Unauthorized: target employee is outside your reporting scope.");
    }

    const reason = input.reason.trim();
    if (!reason) {
      throw new Error("Reason is required.");
    }

    const now = new Date();
    let inactiveUntilDate: Date | null = null;
    if (input.action === "inactive_till") {
      inactiveUntilDate = toDateOrNull(input.inactiveUntil);
      if (!inactiveUntilDate) {
        throw new Error("Inactive till date is required.");
      }
      if (inactiveUntilDate.getTime() <= now.getTime()) {
        throw new Error("Inactive till date must be in the future.");
      }
    }

    const actor = buildLifecycleActor(caller);
    const currentStatus = normalizeUserStatus(targetUser.status);
    let transferredLeadIds: string[] = [];

    if (input.action === "deactivate" || input.action === "terminate") {
      const managerUid =
        getEffectiveReportsToUid(targetUser) ??
        (isManagerOrAboveRole(caller) ? caller.uid : null);
      if (!managerUid) {
        throw new Error("No reporting manager configured for this employee. Assign reportsTo before lifecycle action.");
      }

      const managerSnap = await adminDb.collection("users").doc(managerUid).get();
      if (!managerSnap.exists) {
        throw new Error("Reporting manager profile not found.");
      }
      const managerUser = { ...(managerSnap.data() as UserDoc), uid: managerSnap.id };

      const transferReason = `Employee ${input.action.replace("_", " ")}: ${reason}`;
      const transferResult = await transferActiveLeadsToManager({
        adminDb,
        targetUser,
        managerUser,
        actor,
        reason: transferReason,
        action: input.action,
      });
      transferredLeadIds = transferResult.transferredLeadIds;
    }

    const nextPatch: Partial<UserDoc> & Record<string, unknown> = {
      updatedAt: now,
    };
    let nextStatus: "active" | "inactive" | "terminated" = "active";
    let nextLifecycleState: "active" | "deactivated" | "inactive_till" | "terminated" = "active";

    if (input.action === "deactivate") {
      nextStatus = "inactive";
      nextLifecycleState = "deactivated";
      Object.assign(nextPatch, {
        status: "inactive",
        isActive: false,
        lifecycleState: "deactivated",
        inactiveUntil: null,
        deactivatedAt: now,
        deactivatedBy: actor,
        deactivatedReason: reason,
      });
    } else if (input.action === "inactive_till") {
      nextStatus = "inactive";
      nextLifecycleState = "inactive_till";
      Object.assign(nextPatch, {
        status: "inactive",
        isActive: false,
        lifecycleState: "inactive_till",
        inactiveUntil: inactiveUntilDate,
        deactivatedAt: now,
        deactivatedBy: actor,
        deactivatedReason: reason,
      });
    } else if (input.action === "terminate") {
      nextStatus = "terminated";
      nextLifecycleState = "terminated";
      Object.assign(nextPatch, {
        status: "terminated",
        isActive: false,
        lifecycleState: "terminated",
        inactiveUntil: null,
        terminatedAt: now,
        terminatedBy: actor,
        terminatedReason: reason,
      });
    } else {
      nextStatus = "active";
      nextLifecycleState = "active";
      Object.assign(nextPatch, {
        status: "active",
        isActive: true,
        lifecycleState: "active",
        inactiveUntil: null,
        reactivatedAt: now,
        reactivatedBy: actor,
        reactivatedReason: reason,
      });
    }

    await adminDb.collection("users").doc(targetUser.uid).set(nextPatch, { merge: true });

    const auditBase = {
      targetUid: targetUser.uid,
      targetDisplayName: targetUser.displayName ?? targetUser.email ?? targetUser.uid,
      action: input.action,
      reason,
      previousStatus: currentStatus,
      nextStatus,
      previousLifecycleState: String((targetUser as Record<string, unknown>).lifecycleState ?? "active"),
      nextLifecycleState,
      actor,
      inactiveUntil: inactiveUntilDate ?? null,
      transferredLeads: transferredLeadIds.length,
      transferredLeadIds: transferredLeadIds.slice(0, 300),
      createdAt: now,
    };

    const auditRef = adminDb.collection("employee_lifecycle_audit").doc();
    await Promise.all([
      auditRef.set({
        id: auditRef.id,
        ...auditBase,
      }),
      adminDb
        .collection("users")
        .doc(targetUser.uid)
        .collection("lifecycle_audit")
        .doc(auditRef.id)
        .set({
          id: auditRef.id,
          ...auditBase,
        }),
    ]);

    const actionLabel =
      input.action === "inactive_till"
        ? `set inactive till ${inactiveUntilDate?.toISOString().slice(0, 10)}`
        : input.action.replace("_", " ");

    return {
      success: true,
      message: `Employee ${actionLabel} successfully.`,
      transferredLeads: transferredLeadIds.length,
      transferredLeadIds,
      targetStatus: nextStatus,
    };
  } catch (error: unknown) {
    console.error("Employee lifecycle update failed", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

export async function applyPipFailureDecision(
  input: PIPFailureDecisionInput,
): Promise<LifecycleActionResult> {
  try {
    const { adminAuth, adminDb } = await getAdmin();
    const decodedToken = await adminAuth.verifyIdToken(input.callerIdToken);
    const callerUid = decodedToken.uid;

    const [callerSnap, targetSnap, pipCaseSnap] = await Promise.all([
      adminDb.collection("users").doc(callerUid).get(),
      adminDb.collection("users").doc(input.targetUid).get(),
      adminDb.collection("bda_pip_cases").doc(input.pipCaseId).get(),
    ]);

    if (!callerSnap.exists) {
      throw new Error("Caller profile not found.");
    }
    if (!targetSnap.exists) {
      throw new Error("Target employee not found.");
    }
    if (!pipCaseSnap.exists) {
      throw new Error("PIP case not found.");
    }

    const caller = { ...(callerSnap.data() as UserDoc), uid: callerSnap.id };
    const targetUser = { ...(targetSnap.data() as UserDoc), uid: targetSnap.id };
    const pipCase = pipCaseSnap.data() as Record<string, unknown>;

    if (!canManageEmployeeLifecycle(caller)) {
      throw new Error("Unauthorized: manager+ or HR access required.");
    }
    const inScope = await canManageLifecycleTarget({
      adminDb,
      caller,
      targetUid: targetUser.uid,
    });
    if (!inScope) {
      throw new Error("Unauthorized: target employee is outside your reporting scope.");
    }
    if (String(pipCase.bdaUid ?? "") !== targetUser.uid) {
      throw new Error("PIP case target mismatch.");
    }
    if (String(pipCase.status ?? "") !== "failed") {
      throw new Error("PIP fail actions can only be applied on failed PIP cases.");
    }

    const reason = input.reason.trim();
    if (!reason) {
      throw new Error("Reason is required.");
    }

    let inactiveUntilDate: Date | null = null;
    let lifecycleReason = `PIP fail action: ${reason}`;
    let lifecycleResult: LifecycleActionResult;

    if (input.decision === "terminate") {
      lifecycleResult = await updateEmployeeLifecycle({
        targetUid: targetUser.uid,
        action: "terminate",
        reason: lifecycleReason,
        callerIdToken: input.callerIdToken,
      });
    } else {
      const now = new Date();
      if (input.decision === "extend_inactive") {
        const extensionDays = Math.max(1, Math.min(365, Math.trunc(Number(input.extensionDays ?? 14) || 14)));
        const existingUntil = toDateOrNull((targetUser as Record<string, unknown>).inactiveUntil);
        const base = existingUntil && existingUntil.getTime() > now.getTime() ? existingUntil : now;
        inactiveUntilDate = new Date(base.getTime() + extensionDays * 24 * 60 * 60 * 1000);
        lifecycleReason = `PIP fail action (extend inactive by ${extensionDays} days): ${reason}`;
      } else {
        inactiveUntilDate = toDateOrNull(input.inactiveUntil);
        if (!inactiveUntilDate) {
          throw new Error("Inactive till date is required.");
        }
        if (inactiveUntilDate.getTime() <= now.getTime()) {
          throw new Error("Inactive till date must be in the future.");
        }
        lifecycleReason = `PIP fail action (set fixed inactivity window): ${reason}`;
      }

      lifecycleResult = await updateEmployeeLifecycle({
        targetUid: targetUser.uid,
        action: "inactive_till",
        reason: lifecycleReason,
        callerIdToken: input.callerIdToken,
        inactiveUntil: inactiveUntilDate,
      });
    }

    if (!lifecycleResult.success) {
      throw new Error(lifecycleResult.error || "Failed to apply lifecycle action for PIP case.");
    }

    const actor = buildLifecycleActor(caller);
    const now = new Date();
    await adminDb.collection("bda_pip_cases").doc(input.pipCaseId).set(
      {
        failAction: input.decision,
        failActionAt: now,
        failActionBy: actor,
        failActionReason: reason,
        inactiveUntil: inactiveUntilDate ?? null,
        updatedAt: now,
      },
      { merge: true },
    );

    return {
      ...lifecycleResult,
      success: true,
      message: "PIP fail action applied successfully.",
    };
  } catch (error: unknown) {
    console.error("PIP fail action failed", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

export async function createCounsellingEntry(input: CounsellingEntryInput) {
  try {
    const { adminAuth, adminDb } = await getAdmin();
    const decodedToken = await adminAuth.verifyIdToken(input.callerIdToken);
    const callerUid = decodedToken.uid;
    const callerSnap = await adminDb.collection("users").doc(callerUid).get();
    if (!callerSnap.exists) {
      throw new Error("Caller profile not found.");
    }
    const caller = { ...(callerSnap.data() as UserDoc), uid: callerSnap.id };
    if (!isBdaRole(caller)) {
      throw new Error("Only BDA users can submit counselling entries.");
    }

    const counsellingCount = Math.max(0, Math.trunc(Number(input.counsellingCount || 0)));
    if (counsellingCount <= 0) {
      throw new Error("Counselling count must be at least 1.");
    }
    if (counsellingCount > 100) {
      throw new Error("Counselling count is too high for one entry.");
    }

    const entryDate = input.entryDateKey ? dateKeyToDate(input.entryDateKey) : new Date();
    if (!entryDate) {
      throw new Error("Entry date is invalid.");
    }
    const now = new Date();
    if (entryDate.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      throw new Error("Entry date cannot be in the future.");
    }

    const managerUid = getEffectiveReportsToUid(caller) ?? null;
    const managerName = managerUid
      ? (await adminDb.collection("users").doc(managerUid).get()).data()?.displayName ?? managerUid
      : "-";
    const cycleMeta = buildCounsellingEntryCycleMeta({ date: entryDate });

    const entryRef = adminDb.collection("bda_counselling_entries").doc();
    await entryRef.set({
      id: entryRef.id,
      bdaUid: caller.uid,
      bdaName: caller.displayName ?? caller.email ?? caller.uid,
      managerUid,
      managerName,
      cycleIndex: cycleMeta.cycleIndex,
      cycleLabel: cycleMeta.cycleLabel,
      entryDateKey: toDateKey(entryDate),
      counsellingCount,
      notes: input.notes?.trim() || null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: null,
    });

    return {
      success: true,
      message: "Counselling entry submitted for review.",
      entryId: entryRef.id,
    };
  } catch (error: unknown) {
    console.error("Create counselling entry failed", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

export async function reviewCounsellingEntry(input: CounsellingReviewInput) {
  try {
    const { adminAuth, adminDb } = await getAdmin();
    const decodedToken = await adminAuth.verifyIdToken(input.callerIdToken);
    const callerUid = decodedToken.uid;

    const [callerSnap, entrySnap] = await Promise.all([
      adminDb.collection("users").doc(callerUid).get(),
      adminDb.collection("bda_counselling_entries").doc(input.entryId).get(),
    ]);
    if (!callerSnap.exists) {
      throw new Error("Caller profile not found.");
    }
    if (!entrySnap.exists) {
      throw new Error("Counselling entry not found.");
    }

    const caller = { ...(callerSnap.data() as UserDoc), uid: callerSnap.id };
    const entry = entrySnap.data() as Record<string, unknown>;

    const canReview =
      isExecutiveRole(caller) ||
      isHrRole(caller) ||
      isManagerOrAboveRole(caller);
    if (!canReview) {
      throw new Error("Unauthorized: manager+ or HR access required.");
    }

    const targetUid = String(entry.bdaUid ?? "");
    if (!targetUid) {
      throw new Error("Invalid counselling entry target.");
    }
    const inScope = await canManageLifecycleTarget({
      adminDb,
      caller,
      targetUid,
    });
    if (!inScope) {
      throw new Error("Unauthorized: target BDA is outside your reporting scope.");
    }

    const status = input.status;
    if (status !== "approved" && status !== "rejected") {
      throw new Error("Invalid review status.");
    }
    const reviewReason = input.reason?.trim() || null;
    if (status === "rejected" && !reviewReason) {
      throw new Error("Reason is required for rejected entries.");
    }

    const now = new Date();
    await adminDb.collection("bda_counselling_entries").doc(input.entryId).set(
      {
        status,
        updatedAt: now,
        reviewedAt: now,
        reviewedBy: buildLifecycleActor(caller),
        reviewNote: reviewReason,
      },
      { merge: true },
    );

    return {
      success: true,
      message: `Counselling entry ${status}.`,
    };
  } catch (error: unknown) {
    console.error("Counselling review failed", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

export async function qualifyBdaTrainee(input: QualifyBdaTraineeInput) {
  try {
    const { adminAuth, adminDb } = await getAdmin();
    const decodedToken = await adminAuth.verifyIdToken(input.callerIdToken);
    const callerUid = decodedToken.uid;

    const [callerSnap, targetSnap] = await Promise.all([
      adminDb.collection("users").doc(callerUid).get(),
      adminDb.collection("users").doc(input.targetUid).get(),
    ]);

    if (!callerSnap.exists) {
      throw new Error("Caller profile not found.");
    }
    if (!targetSnap.exists) {
      throw new Error("Target trainee not found.");
    }

    const caller = { ...(callerSnap.data() as UserDoc), uid: callerSnap.id };
    const targetUser = { ...(targetSnap.data() as UserDoc), uid: targetSnap.id };

    const canQualify =
      isExecutiveRole(caller) ||
      isHrRole(caller) ||
      isSeniorManagerOrAboveRole(caller);
    if (!canQualify) {
      throw new Error("Unauthorized: HR or Senior Manager+ access required.");
    }

    if (!isBdaTraineeRole(targetUser)) {
      throw new Error("Selected employee is not in BDA trainee role.");
    }

    if (!isExecutiveRole(caller) && !isHrRole(caller)) {
      const inScope = await canManageLifecycleTarget({
        adminDb,
        caller,
        targetUid: targetUser.uid,
      });
      if (!inScope) {
        throw new Error("Unauthorized: target trainee is outside your reporting scope.");
      }
    }

    const now = new Date();
    const traineeStartedAt =
      toDateOrNull(targetUser.traineeProgram?.startedAt) ??
      toDateOrNull(targetUser.createdAt) ??
      now;
    const traineeEndExclusive = new Date(
      traineeStartedAt.getTime() + BDA_TRAINEE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const [ownerSnap, assignedSnap] = await Promise.all([
      adminDb.collection("leads").where("ownerUid", "==", targetUser.uid).limit(3000).get(),
      adminDb.collection("leads").where("assignedTo", "==", targetUser.uid).limit(3000).get(),
    ]);
    const leadDocs = new Map<string, (typeof ownerSnap.docs)[number]>();
    ownerSnap.docs.forEach((docRow) => leadDocs.set(docRow.id, docRow));
    assignedSnap.docs.forEach((docRow) => leadDocs.set(docRow.id, docRow));

    let qualifyingSales = 0;
    for (const row of leadDocs.values()) {
      const lead = row.data() as LeadDoc;
      if (!isClosedLeadStatus(lead.status)) continue;
      const closedAt =
        toDateOrNull(lead.enrollmentDetails?.closedAt) ??
        toDateOrNull(lead.closedAt) ??
        toDateOrNull(lead.updatedAt) ??
        toDateOrNull(lead.createdAt);
      if (!closedAt) continue;
      if (
        closedAt.getTime() >= traineeStartedAt.getTime() &&
        closedAt.getTime() < traineeEndExclusive.getTime()
      ) {
        qualifyingSales += 1;
      }
    }

    if (qualifyingSales < BDA_TRAINEE_REQUIRED_SALES) {
      throw new Error(
        `Trainee needs at least ${BDA_TRAINEE_REQUIRED_SALES} sale within ${BDA_TRAINEE_WINDOW_DAYS} days before qualification.`,
      );
    }

    const actor = buildLifecycleActor(caller);
    const note = input.reason?.trim() || null;

    await adminDb.collection("users").doc(targetUser.uid).set(
      {
        role: "employee",
        orgRole: "BDA",
        updatedAt: now,
        traineeProgram: {
          ...(targetUser.traineeProgram ?? {}),
          status: "qualified",
          startedAt: traineeStartedAt,
          expectedEndAt: traineeEndExclusive,
          requiredSales: BDA_TRAINEE_REQUIRED_SALES,
          requiredDays: BDA_TRAINEE_WINDOW_DAYS,
          qualifiedAt: now,
          qualifiedBy: actor,
          qualificationReason: note,
          qualificationSales: qualifyingSales,
        },
      },
      { merge: true },
    );

    const auditRef = adminDb.collection("bda_trainee_qualification_audit").doc();
    await auditRef.set({
      id: auditRef.id,
      targetUid: targetUser.uid,
      targetName: targetUser.displayName ?? targetUser.email ?? targetUser.uid,
      previousOrgRole: targetUser.orgRole ?? targetUser.role ?? null,
      nextOrgRole: "BDA",
      salesCountInWindow: qualifyingSales,
      traineeStartedAt,
      traineeEndExclusive,
      qualifiedAt: now,
      reason: note,
      actor,
      createdAt: now,
      updatedAt: now,
    });

    return {
      success: true,
      message: "Trainee qualified to BDA successfully.",
      salesCountInWindow: qualifyingSales,
      traineeWindowDays: BDA_TRAINEE_WINDOW_DAYS,
    };
  } catch (error: unknown) {
    console.error("Qualify BDA trainee failed", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

export async function terminateEmployee(
  targetUid: string, 
  reason: string, 
  callerIdToken: string // Passed from client to verify permissions
) {
  return updateEmployeeLifecycle({
    targetUid,
    action: "terminate",
    reason,
    callerIdToken,
  });
}

export async function updatePayroll(
  payrollId: string,
  updates: {
    baseSalary: number;
    bonus: number;
    deductions: number;
    commissionPercentage: number;
  },
  callerIdToken: string,
  createIfMissing?: {
    uid: string;
    month: string;
  }
) {
  try {
    const { adminAuth, adminDb } = await getAdmin();

    // 1. Verify Caller
    const decodedToken = await adminAuth.verifyIdToken(callerIdToken);
    const callerUid = decodedToken.uid;
    const callerSnap = await adminDb.collection("users").doc(callerUid).get();
    const callerData = callerSnap.data();
    const role = (callerData?.role || "").toUpperCase();
    const orgRole = (callerData?.orgRole || "").toUpperCase();
    
    if (role !== "HR" && orgRole !== "HR" && orgRole !== "SUPER_ADMIN") {
        throw new Error("Unauthorized");
    }

    // 2. Fetch or Initialize Payroll Doc
    const payrollRef = adminDb.collection("payroll").doc(payrollId);
    const payrollSnap = await payrollRef.get();
    let payroll: Payroll;

    if (!payrollSnap.exists) {
        if (!createIfMissing) throw new Error("Payroll record not found");
        
        // Fetch User details for defaults
        const userSnap = await adminDb.collection("users").doc(createIfMissing.uid).get();
        if (!userSnap.exists) throw new Error("User not found");
        const userData = userSnap.data();

        // Calculate Attendance Stats (Reused Logic)
        const [year, month] = createIfMissing.month.split("-").map(Number);
        const mm = String(month).padStart(2, "0");
        const startKey = `${year}-${mm}-01`;
        const endKey = `${year}-${mm}-31`;

        const attendanceSnap = await adminDb.collectionGroup("days")
            .where("userId", "==", createIfMissing.uid)
            .where("dateKey", ">=", startKey)
            .where("dateKey", "<=", endKey)
            .get();
        
        let daysPresent = 0;
        let lates = 0;

        attendanceSnap.forEach(doc => {
            const d = doc.data();
            if (d.dayStatus === "present" || d.dayStatus === "late") daysPresent++;
            if (d.dayStatus === "late") lates++;
        });

        // Initialize new payroll object
        payroll = {
            id: payrollId,
            uid: createIfMissing.uid,
            month: createIfMissing.month,
            baseSalary: updates.baseSalary, // Use provided update
            daysPresent,
            daysAbsent: 30 - daysPresent,
            lates,
            incentives: 0,
            deductions: 0, // Will be overwritten by update logic
            netSalary: 0,
            status: "GENERATED",
            generatedAt: new Date(),
            userDisplayName: userData?.displayName,
            userEmail: userData?.email,
            commissionPercentage: 0,
            bonus: 0,
            totalSalesVolume: 0
        };
    } else {
        payroll = payrollSnap.data() as Payroll;
    }

    // 3. Calculate Sales Volume
    let totalSalesVolume = 0;
    
    // Parse month (YYYY-MM)
    const [year, month] = payroll.month.split("-").map(Number);
    // Start of month
    const start = new Date(year, month - 1, 1);
    // End of month
    const end = new Date(year, month, 0, 23, 59, 59);

    // Fetch closed leads for this user
    // Note: We check both assignedTo and ownerUid to be safe, or just assignedTo
    // Using assignedTo is safer for current ownership
    const leadsSnap = await adminDb.collection("leads")
        .where("assignedTo", "==", payroll.uid)
        .where("status", "==", "closed")
        .get();

    leadsSnap.forEach(doc => {
        const d = doc.data();
        // Determine closure date logic: closedAt -> updatedAt -> createdAt
        const ts = d.enrollmentDetails?.closedAt || d.closedAt || d.updatedAt || d.createdAt;
        let date: Date | null = null;
        
        if (ts && typeof ts.toDate === 'function') {
            date = ts.toDate();
        } else if (ts) {
            date = new Date(ts);
        }

        if (date && date >= start && date <= end) {
             // Amount logic: courseFees -> amount -> fee
             const amt = Number(d.courseFees || d.amount || d.enrollmentDetails?.fee || 0);
             totalSalesVolume += amt;
        }
    });

    // 4. Calculate Incentive
    let incentives = 0;
    if (updates.commissionPercentage > 0) {
        incentives = totalSalesVolume * (updates.commissionPercentage / 100);
    }

    // 5. Calculate Net (If creating new, use daysPresent logic for base calculation??)
    // Actually, if we are updating baseSalary, we should probably re-calculate the pro-rated salary if it's based on attendance?
    // The current logic in generatePayroll is: salary = (base / 30) * daysPresent.
    // But here in updatePayroll, we seem to take baseSalary as the *fixed* amount or *gross*?
    // Let's stick to the existing update logic: net = base + bonus + incentives - deductions.
    // This implies that when editing, the "baseSalary" field becomes the "Actual Payable Base" rather than "Gross Annual/Monthly Base".
    // This is a common pattern: Generate calculates the payable base, and Edit overrides it.
    
    const netSalary = (updates.baseSalary || 0) + (updates.bonus || 0) + incentives - (updates.deductions || 0);

    const updatedData = {
        ...payroll,
        baseSalary: updates.baseSalary,
        bonus: updates.bonus,
        deductions: updates.deductions,
        commissionPercentage: updates.commissionPercentage,
        totalSalesVolume,
        incentives,
        netSalary: Math.round(netSalary),
        updatedAt: new Date()
    };

    if (!payrollSnap.exists) {
        await payrollRef.set(updatedData);
    } else {
        await payrollRef.update(updatedData);
    }

    return { success: true };

  } catch (error: unknown) {
    console.error("Update Payroll Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

async function generateUniqueEmployeeIdAdmin(adminDb: Firestore): Promise<string> {
  const prefix = "EBH";
  let isUnique = false;
  let customId = "";

  while (!isUnique) {
    const randomDigits = Math.floor(10000 + Math.random() * 90000);
    customId = `${prefix}${randomDigits}`;

    const snapshot = await adminDb.collection('users').where('employeeId', '==', customId).get();

    if (snapshot.empty) {
      isUnique = true;
    }
  }

  return customId;
}

export async function createEmployee(
  data: {
    email: string;
    name: string;
    role: string;
    password?: string; // Optional: Generate if missing
    supervisorId?: string;
  },
  callerIdToken: string
) {
  console.log("Starting createEmployee action for:", data.email);
  try {
    const { adminAuth, adminDb } = await getAdmin();
    
    // Debug: Verify Admin SDK Access
    const projectConfig = adminAuth.app.options;
    try {
        console.log("[Admin SDK] Verifying database access...");
        console.log("[Admin SDK] Configured Project ID:", projectConfig.projectId || "Unknown");
        // Perform a lightweight read to verify permissions
        await adminDb.collection("users").limit(1).get();
        console.log("[Admin SDK] Read access verified.");
    } catch (sdkError: unknown) {
        console.error("[Admin SDK] Access Check Failed:", sdkError);
        const err = sdkError as { code?: string; message?: string };
        return { 
            success: false, 
            error: `Server Configuration Error: Admin SDK (Project: ${projectConfig.projectId}) cannot access Firestore. Code: ${err.code || 'Unknown'}. Message: ${err.message}. Check if Service Account credentials match the project.` 
        };
    }

    // 1. Verify Caller
    let callerUid;
    try {
        const decodedToken = await adminAuth.verifyIdToken(callerIdToken);
        callerUid = decodedToken.uid;
    } catch (authError) {
        console.error("Token verification failed:", authError);
        return { success: false, error: "Authentication Failed: Invalid session." };
    }

    const callerSnap = await adminDb.collection("users").doc(callerUid).get();
    if (!callerSnap.exists) {
        return { success: false, error: "Caller profile not found." };
    }
    const callerData = callerSnap.data();
    const role = (callerData?.role || "").toUpperCase();
    const orgRole = (callerData?.orgRole || "").toUpperCase();
    
    if (role !== "HR" && orgRole !== "HR" && orgRole !== "SUPER_ADMIN") {
        return { success: false, error: "Unauthorized: Insufficient permissions." };
    }

    // 2. Create Auth User
    const password = data.password || Math.random().toString(36).slice(-8) + "Aa1!";
    let newUser;
    try {
        newUser = await adminAuth.createUser({
            email: data.email,
            password: password,
            displayName: data.name,
            emailVerified: true // Pre-verify since HR created it
        });
    } catch (createUserError: unknown) {
        console.error("Auth User Creation Error:", createUserError);
        const err = createUserError as { message?: string; code?: string };
        return { success: false, error: "Failed to create account: " + (err.message || err.code) };
    }

    // 3. Create Firestore Doc
    const employeeId = await generateUniqueEmployeeIdAdmin(adminDb);

    const userData: Record<string, unknown> = {
        uid: newUser.uid,
        employeeId,
        email: data.email,
        displayName: data.name,
        role: data.role, // e.g., 'employee'
        status: "active",
        isActive: true,
        createdAt: new Date(),
        onboardingCompleted: false,
        settings: { workspace: "CRM" } // Default
    };

    if (data.supervisorId) {
        userData.supervisorId = data.supervisorId;
    }

    try {
        await adminDb.collection("users").doc(newUser.uid).set(userData);
    } catch (firestoreError: unknown) {
        console.error("Firestore Error:", firestoreError);
        // Attempt cleanup
        try { await adminAuth.deleteUser(newUser.uid); } catch (e) { console.error("Cleanup failed:", e); }
        
        const err = firestoreError as { message?: string };
        return { success: false, error: "Database Error: " + (err.message || "Permission Denied") };
    }

    // 4. Send Welcome Email
    try {
        const subject = "Welcome to People Edubh - Your Account Details";
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://people.edubh.com";
        const loginUrl = `${baseUrl}/onboarding`;
        
        const html = `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #0f172a;">Welcome to People Edubh!</h2>
            <p>Dear ${data.name},</p>
            <p>Your account has been successfully created. Here are your temporary login credentials:</p>
            
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>Email:</strong> ${data.email}</p>
              <p style="margin: 5px 0;"><strong>Temporary Password:</strong> ${password}</p>
              <p style="margin: 5px 0;"><strong>Role:</strong> ${data.role}</p>
            </div>
    
            <p>Please log in and complete your onboarding process:</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${loginUrl}" 
                 style="background-color: #0f172a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Login to Dashboard
              </a>
            </div>
    
            <p style="font-size: 14px; color: #64748b;">
              Note: You will be prompted to change your password upon your first login.
            </p>
            
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
            
            <p style="font-size: 12px; color: #94a3b8; text-align: center;">
              This is an automated message. Please do not reply to this email.
            </p>
          </div>
        `;
        
        await sendEmail(data.email, subject, html);
        console.log(`Welcome email sent to ${data.email}`);
    } catch (emailError) {
        console.error("Email Sending Error:", emailError);
        // We don't fail the operation if email fails, as the admin sees the password
    }

    return { success: true, uid: newUser.uid, password, employeeId }; // Return password to show one-time
  } catch (error: unknown) {
    console.error("Create Employee Unexpected Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

export async function generatePayroll(monthYear: string, callerIdToken: string) {
  // monthYear format: "YYYY-MM"
  try {
    const { adminAuth, adminDb } = await getAdmin();

    // 1. Verify Caller
    const decodedToken = await adminAuth.verifyIdToken(callerIdToken);
    const callerUid = decodedToken.uid;
    const callerSnap = await adminDb.collection("users").doc(callerUid).get();
    const callerData = callerSnap.data();
    const role = (callerData?.role || "").toUpperCase();
    const orgRole = (callerData?.orgRole || "").toUpperCase();
    
    if (role !== "HR" && orgRole !== "HR" && orgRole !== "SUPER_ADMIN") {
        throw new Error("Unauthorized");
    }

    // 2. Define Date Range
    const [year, month] = monthYear.split("-").map(Number);
    const mm = String(month).padStart(2, "0");
    const startKey = `${year}-${mm}-01`;
    const endKey = `${year}-${mm}-31`;

    // 3. Fetch Active Users
    const usersSnap = await adminDb.collection("users").where("status", "==", "active").get();
    const users = usersSnap.docs.map(d => d.data());

    // 4. Fetch Attendance for the Month (Optimization: Fetch all and group in memory)
    // Use collectionGroup to query 'days' subcollection which stores daily attendance
    const attendanceSnap = await adminDb.collectionGroup("days")
        .where("dateKey", ">=", startKey)
        .where("dateKey", "<=", endKey)
        .get();
    const approvedLeavesSnap = await adminDb
      .collection("leaveRequests")
      .where("status", "==", "approved")
      .limit(5000)
      .get();
    
    const attendanceByUid: Record<
      string,
      {
        uid?: string;
        userId?: string;
        dayStatus?: string;
        correctionStatus?: string;
        correctionReason?: string | null;
        [key: string]: unknown;
      }[]
    > = {};
    attendanceSnap.forEach(doc => {
        const data = doc.data() as { uid?: string; userId?: string; dayStatus?: string; [key: string]: unknown };
        const uid = data.uid || data.userId;
        if (!uid) return;
        if (!attendanceByUid[uid]) attendanceByUid[uid] = [];
        attendanceByUid[uid].push(data);
    });
    const approvedLeaveSummaryByUid = buildMonthlyApprovedLeaveSummaryByUser(
      approvedLeavesSnap.docs.map((doc) => doc.data()),
      monthYear,
    );

    const payrolls = [];
    const batch = adminDb.batch();

    for (const user of users) {
        if (!user.salaryStructure) continue; // Skip if no salary info

        const uid = user.uid;
        const userAttendance = attendanceByUid[uid] || [];
        
        // Calculate Days Present based on dayStatus ('present' or 'late')
        const daysPresent = userAttendance.filter(a => 
            a.dayStatus === "present" || a.dayStatus === "late"
        ).length;

        // Simple Logic
        const base = Number(user.salaryStructure.base) || 0;
        const perDay = base / 30; // Standard payroll month
        
        // Lates/Deductions
        const lates = userAttendance.filter(a => a.dayStatus === "late").length;
        const deductionRate = Number(user.salaryStructure.deductionRate) || 0;
        const lateDeduction = lates * deductionRate;
        const leaveSummary = approvedLeaveSummaryByUid[uid];
        const leaveImpact = calculateMonthlyLeaveDeduction({
          approvedChargeableDays: leaveSummary?.chargeableLeaveDays ?? 0,
          baseSalary: base,
        });
        const attendanceCorrections = userAttendance.filter((day) => {
          const status = String(day.correctionStatus ?? "").toLowerCase();
          return status === "approved" || status === "rejected" || status === "pending_hr_review";
        });
        const attendanceCorrectionPendingCount = attendanceCorrections.filter(
          (day) => String(day.correctionStatus ?? "").toLowerCase() === "pending_hr_review",
        ).length;
        const attendanceCorrectionReasons = Array.from(
          new Set(
            attendanceCorrections
              .map((day) => (typeof day.correctionReason === "string" ? day.correctionReason.trim() : ""))
              .filter(Boolean),
          ),
        ).slice(0, 5);
        const attendanceCorrectionSummary =
          attendanceCorrectionReasons.length > 0 ? attendanceCorrectionReasons.join(" | ") : null;
        const paidLeaveDays = Math.min(leaveImpact.approvedChargeableDays, leaveImpact.allowanceDays);
        const payableDays = Math.min(30, daysPresent + paidLeaveDays);
        const grossSalary = perDay * payableDays;
        const leaveDeduction = leaveImpact.deductionAmount;
        const deductions = lateDeduction + leaveDeduction;

        const net = Math.max(0, grossSalary - deductions);

        const payrollId = `${uid}_${monthYear}`;
        const payrollRef = adminDb.collection("payroll").doc(payrollId);
        
        const payrollData = {
            id: payrollId,
            uid,
            month: monthYear,
            baseSalary: base,
            daysPresent,
            daysAbsent: Math.max(0, 30 - payableDays),
            lates,
            incentives: 0, // Manual adjustment later
            lateDeduction,
            leaveApprovedDays: leaveImpact.approvedChargeableDays,
            paidLeaveDays,
            leaveAllowanceDays: leaveImpact.allowanceDays,
            leaveExcessDays: leaveImpact.excessLeaveDays,
            unpaidLeaveDays: leaveImpact.excessLeaveDays,
            leaveDeduction,
            saturdayExcludedDays: leaveSummary?.saturdayExcludedDays ?? 0,
            sundayExcludedDays: leaveSummary?.sundayExcludedDays ?? 0,
            attendanceCorrectionCount: attendanceCorrections.length,
            attendanceCorrectionPendingCount,
            attendanceCorrectionReasons,
            attendanceCorrectionSummary,
            deductions,
            netSalary: Math.round(net),
            status: "GENERATED",
            generatedAt: new Date(),
            userDisplayName: user.displayName,
            userEmail: user.email
        };

        batch.set(payrollRef, payrollData);
        payrolls.push(payrollData);
    }

    await batch.commit();

    return { success: true, count: payrolls.length };

  } catch (error: unknown) {
    console.error("Generate Payroll Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}
