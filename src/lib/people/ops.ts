"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import {
  isAdminUser,
  isHrUser,
  isManagerUser,
  isTeamLeadUser,
  normalizeRoleValue,
} from "@/lib/access";
import { usePeopleDirectoryData } from "@/lib/people/directory";
import { fetchPeoplePayrollSnapshot } from "@/lib/people/payroll-workspace";
import type { LeaveRequestDoc } from "@/lib/types/attendance";
import type { UserDoc } from "@/lib/types/user";

export type HrAttendanceRecord = {
  id: string;
  uid?: string;
  userId?: string;
  status: string;
  checkInTime?: Timestamp | null;
  checkedInAt?: Timestamp | null;
  checkOutTime?: Timestamp | null;
  checkedOutAt?: Timestamp | null;
  manualUpdate?: boolean;
  updatedAt?: Timestamp | Date | null;
  late?: boolean;
  dayStatus?: string | null;
  dateKey?: string;
  refPath?: string;
  correctionStatus?: "pending_hr_review" | "approved" | "rejected" | null;
  correctionReason?: string | null;
  correctionRequestedBy?: string | null;
  correctionRequestedAt?: Timestamp | Date | null;
  correctionReviewedBy?: string | null;
  correctionReviewedAt?: Timestamp | Date | null;
  correctionReviewReason?: string | null;
  latestOverrideAuditId?: string | null;
};

export type AttendanceOverrideAuditRow = {
  id: string;
  uid: string;
  dateKey: string;
  actionType:
    | "manager_mark_absent"
    | "attendance_override"
    | "hr_review_approved"
    | "hr_review_rejected";
  reason: string;
  correctionStatus: "pending_hr_review" | "approved" | "rejected";
  actor: {
    uid: string;
    role: string | null;
    name: string | null;
  };
  attendanceRefPath: string | null;
  relatedOverrideId: string | null;
  previousSnapshot?: Record<string, unknown> | null;
  nextSnapshot?: Record<string, unknown> | null;
  createdAt?: Timestamp | Date | null;
};

export type HrLeaveRequestRow = LeaveRequestDoc & {
  id: string;
  userName?: string;
  userEmail?: string;
  assignedHrName?: string;
  reportingManagerName?: string;
};

export type LeaveAuthorityTab = "pending" | "approved" | "rejected";

export type PeopleOpsSnapshot = {
  activeEmployees: number;
  pendingLeaves: number;
  activeCandidates: number;
  payrollReadyEmployees: number;
  onLeaveToday: number;
};

function isPresentStatus(status: string | undefined | null) {
  const normalized = (status ?? "").toLowerCase();
  return (
    normalized === "present" ||
    normalized === "checked_in" ||
    normalized === "checked_out" ||
    normalized === "on_break"
  );
}

function isLateRecord(record: HrAttendanceRecord | undefined) {
  if (!record) return false;
  if (record.late === true) return true;
  return (record.dayStatus ?? "").toLowerCase() === "late";
}

function toDateKey(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  if (typeof value === "object") {
    const candidate = value as { toDate?: () => Date; seconds?: number };
    if (typeof candidate.toDate === "function") {
      const parsed = candidate.toDate();
      return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }
    if (typeof candidate.seconds === "number") {
      return candidate.seconds * 1000;
    }
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getActorLabel(actor: Pick<UserDoc, "uid" | "displayName" | "email">) {
  return actor.displayName?.trim() || actor.email?.trim() || actor.uid;
}

function canActorManageAttendanceOverride(actor: UserDoc | null | undefined) {
  return isAdminUser(actor) || isManagerUser(actor);
}

function canActorReviewAttendanceOverride(actor: UserDoc | null | undefined) {
  return isAdminUser(actor) || isHrUser(actor);
}

function toAttendanceSnapshot(record: Partial<HrAttendanceRecord> | null | undefined) {
  if (!record) return null;
  return {
    status: record.status ?? null,
    dayStatus: record.dayStatus ?? null,
    checkedInAt: record.checkedInAt ?? record.checkInTime ?? null,
    checkedOutAt: record.checkedOutAt ?? record.checkOutTime ?? null,
    correctionStatus: record.correctionStatus ?? null,
    correctionReason: record.correctionReason ?? null,
  };
}

function resolveAttendanceStatusPatch(input: {
  dateKey: string;
  status: string;
  checkInTime: string;
}) {
  const normalizedStatus = input.status.toLowerCase();
  const allowed = new Set([
    "present",
    "late",
    "checked_in",
    "checked_out",
    "absent",
    "on_leave",
  ]);
  if (!allowed.has(normalizedStatus)) {
    throw new Error("Unsupported attendance status.");
  }

  const timestamp =
    input.checkInTime && input.checkInTime.length > 0
      ? Timestamp.fromDate(new Date(`${input.dateKey}T${input.checkInTime}`))
      : null;

  if (normalizedStatus === "absent") {
    return {
      status: "absent",
      dayStatus: "absent",
      checkedInAt: null,
      checkInTime: null,
      checkedOutAt: null,
      checkOutTime: null,
    } as const;
  }

  if (normalizedStatus === "on_leave") {
    return {
      status: "on_leave",
      dayStatus: "on_leave",
      checkedInAt: null,
      checkInTime: null,
      checkedOutAt: null,
      checkOutTime: null,
    } as const;
  }

  if (normalizedStatus === "late") {
    return {
      status: "checked_in",
      dayStatus: "late",
      checkedInAt: timestamp,
      checkInTime: timestamp,
      checkedOutAt: null,
      checkOutTime: null,
    } as const;
  }

  if (normalizedStatus === "checked_out") {
    const checkedOutAt = Timestamp.now();
    return {
      status: "checked_out",
      dayStatus: "present",
      checkedInAt: timestamp,
      checkInTime: timestamp,
      checkedOutAt,
      checkOutTime: checkedOutAt,
    } as const;
  }

  return {
    status: "checked_in",
    dayStatus: "present",
    checkedInAt: timestamp,
    checkInTime: timestamp,
    checkedOutAt: null,
    checkOutTime: null,
  } as const;
}

function normalizeLeaveStatus(status: string | undefined | null) {
  return (status ?? "").toLowerCase();
}

function isHrPendingStatus(status: string | undefined | null) {
  const normalized = normalizeLeaveStatus(status);
  return normalized === "pending" || normalized === "pending_hr";
}

function isManagerPendingStatus(status: string | undefined | null) {
  return normalizeLeaveStatus(status) === "pending_manager";
}

function isAnyPendingStatus(status: string | undefined | null) {
  const normalized = normalizeLeaveStatus(status);
  return normalized === "pending" || normalized === "pending_hr" || normalized === "pending_manager";
}

function resolveScopedLeaveRows(rows: HrLeaveRequestRow[], currentUser: UserDoc | null) {
  const role = normalizeRoleValue(currentUser?.orgRole ?? currentUser?.role);
  const isExecutive = role === "SUPER_ADMIN" || role === "ADMIN";
  const isHr = role === "HR";
  const isManagerActor = isManagerUser(currentUser) || isTeamLeadUser(currentUser);

  if (isExecutive) return rows;
  if (isHr) {
    return rows.filter((row) => {
      if (!currentUser?.uid) return false;
      if (!row.assignedHR) return true;
      return row.assignedHR === currentUser.uid;
    });
  }
  if (isManagerActor) {
    return rows.filter((row) => row.reportingManagerId === currentUser?.uid);
  }
  return [];
}

export function useHrAttendanceOversight(selectedDate: string) {
  const {
    visibleUsers: directoryUsers,
    loading: usersLoading,
    error: usersError,
  } = usePeopleDirectoryData({
    includeExecutiveControl: false,
    sortMode: "display_name",
  });
  const users = useMemo(
    () => directoryUsers.filter((user) => (user.status ?? "").toLowerCase() === "active"),
    [directoryUsers],
  );

  const [attendanceByUid, setAttendanceByUid] = useState<Record<string, HrAttendanceRecord>>({});
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState<Error | null>(null);
  const [overrideAuditRows, setOverrideAuditRows] = useState<AttendanceOverrideAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<Error | null>(null);

  useEffect(() => {
    if (!db) return;
    const firestore = db;
    setAttendanceLoading(true);
    const attendanceQuery = query(collectionGroup(firestore, "days"), where("dateKey", "==", selectedDate));
    const unsubscribe = onSnapshot(
      attendanceQuery,
      (snapshot) => {
        const byUid: Record<string, HrAttendanceRecord> = {};
        snapshot.docs.forEach((row) => {
          const data = row.data() as HrAttendanceRecord;
          const uid = data.uid || data.userId;
          if (!uid) return;
          byUid[uid] = {
            ...data,
            id: row.id,
            refPath: row.ref.path,
          };
        });
        setAttendanceByUid(byUid);
        setAttendanceLoading(false);
        setAttendanceError(null);
      },
      (error) => {
        setAttendanceError(error instanceof Error ? error : new Error("Unable to load attendance"));
        setAttendanceLoading(false);
      },
    );
    return () => unsubscribe();
  }, [selectedDate]);

  useEffect(() => {
    if (!db) return;
    const firestore = db;
    setAuditLoading(true);
    const auditQuery = query(
      collection(firestore, "attendance_override_audit"),
      where("dateKey", "==", selectedDate),
    );
    const unsubscribe = onSnapshot(
      auditQuery,
      (snapshot) => {
        const rows = snapshot.docs
          .map((entry) => {
            const data = entry.data() as Partial<AttendanceOverrideAuditRow>;
            return {
              id: entry.id,
              uid: typeof data.uid === "string" ? data.uid : "",
              dateKey: typeof data.dateKey === "string" ? data.dateKey : selectedDate,
              actionType:
                data.actionType === "manager_mark_absent" ||
                data.actionType === "attendance_override" ||
                data.actionType === "hr_review_approved" ||
                data.actionType === "hr_review_rejected"
                  ? data.actionType
                  : "attendance_override",
              reason: typeof data.reason === "string" ? data.reason : "-",
              correctionStatus:
                data.correctionStatus === "pending_hr_review" ||
                data.correctionStatus === "approved" ||
                data.correctionStatus === "rejected"
                  ? data.correctionStatus
                  : "pending_hr_review",
              actor: {
                uid: typeof data.actor?.uid === "string" ? data.actor.uid : "unknown",
                role: typeof data.actor?.role === "string" ? data.actor.role : null,
                name: typeof data.actor?.name === "string" ? data.actor.name : null,
              },
              attendanceRefPath:
                typeof data.attendanceRefPath === "string" ? data.attendanceRefPath : null,
              relatedOverrideId:
                typeof data.relatedOverrideId === "string" ? data.relatedOverrideId : null,
              previousSnapshot:
                data.previousSnapshot && typeof data.previousSnapshot === "object"
                  ? (data.previousSnapshot as Record<string, unknown>)
                  : null,
              nextSnapshot:
                data.nextSnapshot && typeof data.nextSnapshot === "object"
                  ? (data.nextSnapshot as Record<string, unknown>)
                  : null,
              createdAt: data.createdAt ?? null,
            } satisfies AttendanceOverrideAuditRow;
          })
          .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
        setOverrideAuditRows(rows);
        setAuditLoading(false);
        setAuditError(null);
      },
      (error) => {
        setAuditError(error instanceof Error ? error : new Error("Unable to load attendance audit"));
        setAuditLoading(false);
      },
    );

    return () => unsubscribe();
  }, [selectedDate]);

  const stats = useMemo(() => {
    const present = Object.values(attendanceByUid).filter((row) => isPresentStatus(row.status)).length;
    const late = Object.values(attendanceByUid).filter((row) => isLateRecord(row)).length;
    const absent = Math.max(0, users.length - present);

    return { present, late, absent };
  }, [attendanceByUid, users.length]);

  return {
    users,
    attendanceByUid,
    overrideAuditRows,
    stats,
    loading: usersLoading || attendanceLoading || auditLoading,
    error: usersError ?? attendanceError ?? auditError,
  };
}

export async function updateHrAttendanceRecord(input: {
  uid: string;
  dateKey: string;
  status: string;
  checkInTime: string;
  reason: string;
  actor: Pick<UserDoc, "uid" | "displayName" | "email" | "role" | "orgRole">;
  record?: HrAttendanceRecord | null;
}) {
  if (!db) throw new Error("Firebase is not configured");
  const firestore = db;
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Override reason is required.");
  }

  const actorUser = {
    uid: input.actor.uid,
    displayName: input.actor.displayName ?? null,
    email: input.actor.email ?? null,
    role: input.actor.role ?? null,
    orgRole: input.actor.orgRole ?? null,
  } as UserDoc;
  const isReviewActor = canActorReviewAttendanceOverride(actorUser);
  const isManagerActor = canActorManageAttendanceOverride(actorUser);
  if (!isReviewActor && !isManagerActor) {
    throw new Error("You do not have permission to override attendance.");
  }

  if (!isReviewActor && input.status.toLowerCase() !== "absent") {
    throw new Error("Manager override is limited to mark-absent action.");
  }

  const statusPatch = resolveAttendanceStatusPatch({
    dateKey: input.dateKey,
    status: input.status,
    checkInTime: input.checkInTime,
  });

  const [yyyy, mm] = input.dateKey.split("-");
  if (!yyyy || !mm) throw new Error("Invalid dateKey");
  const dayRef = input.record?.refPath
    ? doc(firestore, input.record.refPath)
    : doc(firestore, "users", input.uid, "attendance", yyyy, "months", mm, "days", input.dateKey);
  const auditRef = doc(collection(firestore, "attendance_override_audit"));
  const now = new Date();
  const correctionStatus: "pending_hr_review" | "approved" = isReviewActor
    ? "approved"
    : "pending_hr_review";

  const payload = {
    uid: input.uid,
    userId: input.uid,
    dateKey: input.dateKey,
    ...statusPatch,
    manualUpdate: true,
    correctionStatus,
    correctionReason: reason,
    correctionRequestedBy: input.actor.uid,
    correctionRequestedAt: now,
    correctionReviewedBy: isReviewActor ? input.actor.uid : null,
    correctionReviewedAt: isReviewActor ? now : null,
    correctionReviewReason: isReviewActor ? reason : null,
    latestOverrideAuditId: auditRef.id,
    updatedAt: now,
  };

  const batch = writeBatch(firestore);
  batch.set(
    dayRef,
    {
      ...payload,
      ...(input.record?.refPath ? {} : { createdAt: now }),
    },
    { merge: true },
  );
  batch.set(auditRef, {
    uid: input.uid,
    dateKey: input.dateKey,
    actionType: isReviewActor ? "attendance_override" : "manager_mark_absent",
    reason,
    correctionStatus,
    actor: {
      uid: input.actor.uid,
      role: input.actor.orgRole ?? input.actor.role ?? null,
      name: getActorLabel(input.actor),
    },
    attendanceRefPath: dayRef.path,
    relatedOverrideId: null,
    previousSnapshot: toAttendanceSnapshot(input.record),
    nextSnapshot: toAttendanceSnapshot(payload),
    createdAt: now,
  });
  await batch.commit();
}

export async function reviewHrAttendanceOverride(input: {
  overrideAuditId: string;
  decision: "approved" | "rejected";
  reason: string;
  actor: Pick<UserDoc, "uid" | "displayName" | "email" | "role" | "orgRole">;
}) {
  if (!db) throw new Error("Firebase is not configured");
  const firestore = db;
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Review reason is required.");
  }

  const actorUser = {
    uid: input.actor.uid,
    displayName: input.actor.displayName ?? null,
    email: input.actor.email ?? null,
    role: input.actor.role ?? null,
    orgRole: input.actor.orgRole ?? null,
  } as UserDoc;
  if (!canActorReviewAttendanceOverride(actorUser)) {
    throw new Error("Only HR/Admin can review attendance corrections.");
  }

  const overrideRef = doc(firestore, "attendance_override_audit", input.overrideAuditId);
  const overrideSnap = await getDoc(overrideRef);
  if (!overrideSnap.exists()) {
    throw new Error("Override audit entry not found.");
  }
  const data = overrideSnap.data() as Partial<AttendanceOverrideAuditRow>;
  if (data.correctionStatus !== "pending_hr_review") {
    throw new Error("This correction is already reviewed.");
  }

  const attendanceRefPath =
    typeof data.attendanceRefPath === "string" ? data.attendanceRefPath : null;
  if (!attendanceRefPath) {
    throw new Error("Attendance reference is missing for this correction.");
  }

  const dayRef = doc(firestore, attendanceRefPath);
  const reviewAuditRef = doc(collection(firestore, "attendance_override_audit"));
  const now = new Date();
  const nextStatus: "approved" | "rejected" = input.decision;

  const patch: Record<string, unknown> = {
    correctionStatus: nextStatus,
    correctionReviewedBy: input.actor.uid,
    correctionReviewedAt: now,
    correctionReviewReason: reason,
    latestOverrideAuditId: reviewAuditRef.id,
    updatedAt: now,
  };

  if (nextStatus === "rejected") {
    const previous =
      data.previousSnapshot && typeof data.previousSnapshot === "object"
        ? (data.previousSnapshot as Record<string, unknown>)
        : {};
    if (Object.prototype.hasOwnProperty.call(previous, "status")) {
      patch.status = previous.status ?? "checked_out";
    }
    if (Object.prototype.hasOwnProperty.call(previous, "dayStatus")) {
      patch.dayStatus = previous.dayStatus ?? "present";
    }
    if (Object.prototype.hasOwnProperty.call(previous, "checkedInAt")) {
      patch.checkedInAt = previous.checkedInAt ?? null;
      patch.checkInTime = previous.checkedInAt ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(previous, "checkedOutAt")) {
      patch.checkedOutAt = previous.checkedOutAt ?? null;
      patch.checkOutTime = previous.checkedOutAt ?? null;
    }
  }

  const batch = writeBatch(firestore);
  batch.set(dayRef, patch, { merge: true });
  batch.set(reviewAuditRef, {
    uid: typeof data.uid === "string" ? data.uid : "",
    dateKey: typeof data.dateKey === "string" ? data.dateKey : "",
    actionType: nextStatus === "approved" ? "hr_review_approved" : "hr_review_rejected",
    reason,
    correctionStatus: nextStatus,
    actor: {
      uid: input.actor.uid,
      role: input.actor.orgRole ?? input.actor.role ?? null,
      name: getActorLabel(input.actor),
    },
    attendanceRefPath,
    relatedOverrideId: input.overrideAuditId,
    previousSnapshot: data.nextSnapshot ?? null,
    nextSnapshot: patch,
    createdAt: now,
  });
  await batch.commit();
}

export function useHrLeaveAuthority(currentUser: UserDoc | null, activeStatus: LeaveAuthorityTab) {
  const { allUsers } = usePeopleDirectoryData({
    includeExecutiveControl: true,
    sortMode: "display_name",
  });
  const [rows, setRows] = useState<HrLeaveRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!db) return;
    const firestore = db;
    const usersMap = new Map(allUsers.map((user) => [user.uid, user] as const));
    const leaveQuery = query(collection(firestore, "leaveRequests"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      leaveQuery,
      (snapshot) => {
        const nextRows = snapshot.docs.map((row) => {
          const data = row.data() as LeaveRequestDoc;
          const user = usersMap.get(data.uid);
          const assignedHr = data.assignedHR ? usersMap.get(data.assignedHR) : undefined;
          const reportingManager = data.reportingManagerId
            ? usersMap.get(data.reportingManagerId)
            : undefined;
          return {
            ...data,
            id: row.id,
            userName: user?.displayName ?? "Unknown User",
            userEmail: user?.email ?? "No Email",
            assignedHrName: assignedHr?.displayName ?? assignedHr?.email ?? undefined,
            reportingManagerName:
              reportingManager?.displayName ?? reportingManager?.email ?? undefined,
          } as HrLeaveRequestRow;
        });
        setRows(nextRows);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err instanceof Error ? err : new Error("Unable to load leave requests"));
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [allUsers]);

  const scopedRows = useMemo(() => resolveScopedLeaveRows(rows, currentUser), [rows, currentUser]);
  const role = normalizeRoleValue(currentUser?.orgRole ?? currentUser?.role);
  const isExecutive = role === "SUPER_ADMIN" || role === "ADMIN";
  const isHrActor = role === "HR";
  const isManagerActor = isManagerUser(currentUser) || isTeamLeadUser(currentUser);

  const pendingRows = useMemo(() => {
    if (isExecutive) return scopedRows.filter((row) => isAnyPendingStatus(row.status));
    if (isHrActor) return scopedRows.filter((row) => isHrPendingStatus(row.status));
    if (isManagerActor) return scopedRows.filter((row) => isManagerPendingStatus(row.status));
    return [] as HrLeaveRequestRow[];
  }, [isExecutive, isHrActor, isManagerActor, scopedRows]);

  const counts = useMemo(
    () => ({
      pending: pendingRows.length,
      approved: scopedRows.filter((row) => normalizeLeaveStatus(row.status) === "approved").length,
      rejected: scopedRows.filter((row) => normalizeLeaveStatus(row.status) === "rejected").length,
    }),
    [pendingRows, scopedRows],
  );
  const filteredRows = useMemo(() => {
    if (activeStatus === "pending") return pendingRows;
    return scopedRows.filter((row) => normalizeLeaveStatus(row.status) === activeStatus);
  }, [activeStatus, pendingRows, scopedRows]);

  const updateStatus = async (id: string, status: "approved" | "rejected") => {
    if (!db) throw new Error("Firebase is not configured");
    const firestore = db;
    const row = rows.find((entry) => entry.id === id) ?? null;
    if (!row) throw new Error("Unable to locate leave request.");

    const now = new Date();
    const currentStatus = normalizeLeaveStatus(row.status);
    const actorUid = currentUser?.uid ?? null;
    const canHrAct = isHrActor || isExecutive;
    const canManagerAct = isManagerActor || isExecutive;

    if (status === "approved") {
      if ((currentStatus === "pending" || currentStatus === "pending_hr") && canHrAct) {
        if (row.reportingManagerId) {
          await updateDoc(doc(firestore, "leaveRequests", id), {
            status: "pending_manager",
            hrDecision: "approved",
            hrReviewedAt: now,
            hrReviewedBy: actorUid,
            managerDecision: "pending",
            forwardedToManagerAt: now,
            updatedAt: now,
          });
          return;
        }
        await updateDoc(doc(firestore, "leaveRequests", id), {
          status: "approved",
          hrDecision: "approved",
          hrReviewedAt: now,
          hrReviewedBy: actorUid,
          managerDecision: "approved",
          managerReviewedAt: now,
          managerReviewedBy: actorUid,
          updatedAt: now,
        });
        return;
      }

      if (currentStatus === "pending_manager" && canManagerAct) {
        await updateDoc(doc(firestore, "leaveRequests", id), {
          status: "approved",
          managerDecision: "approved",
          managerReviewedAt: now,
          managerReviewedBy: actorUid,
          updatedAt: now,
        });
        return;
      }
    }

    if (status === "rejected") {
      if ((currentStatus === "pending" || currentStatus === "pending_hr") && canHrAct) {
        await updateDoc(doc(firestore, "leaveRequests", id), {
          status: "rejected",
          hrDecision: "rejected",
          hrReviewedAt: now,
          hrReviewedBy: actorUid,
          updatedAt: now,
        });
        return;
      }

      if (currentStatus === "pending_manager" && canManagerAct) {
        await updateDoc(doc(firestore, "leaveRequests", id), {
          status: "rejected",
          managerDecision: "rejected",
          managerReviewedAt: now,
          managerReviewedBy: actorUid,
          updatedAt: now,
        });
        return;
      }
    }

    throw new Error("You do not have permission to update this leave request at this stage.");
  };

  return {
    rows: filteredRows,
    counts,
    loading,
    error,
    updateStatus,
  };
}

export async function getPeopleOpsSnapshot(currentUser: UserDoc | null): Promise<PeopleOpsSnapshot> {
  const snapshot = await fetchPeoplePayrollSnapshot({ currentUser, dateKey: toDateKey() });
  return {
    activeEmployees: snapshot.activeEmployees,
    pendingLeaves: snapshot.pendingLeavesScoped,
    activeCandidates: snapshot.activeCandidates,
    payrollReadyEmployees: snapshot.payrollReadyEmployees,
    onLeaveToday: snapshot.onLeaveTodayScoped,
  };
}
