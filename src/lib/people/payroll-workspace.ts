"use client";

import { useEffect, useState } from "react";
import { collection, getCountFromServer, getDocs, limit, query, where } from "firebase/firestore";
import { isAdminUser, normalizeRoleValue } from "@/lib/access";
import {
  buildMonthlyApprovedLeaveSummaryByUser,
  calculateMonthlyLeaveDeduction,
} from "@/lib/attendance/leave-policy";
import { db } from "@/lib/firebase/client";
import type { LeaveRequestDoc, PresenceDoc } from "@/lib/types/attendance";
import type { Payroll } from "@/lib/types/hr";
import type { UserDoc } from "@/lib/types/user";

type HikeRequestDocLite = {
  status?: string | null;
};

export type PeoplePayrollSnapshot = {
  dateKey: string;
  monthKey: string;
  activeEmployees: number;
  activeCandidates: number;
  payrollReadyEmployees: number;
  pendingLeavesTotal: number;
  pendingLeavesScoped: number;
  onLeaveTodayTotal: number;
  onLeaveTodayScoped: number;
  attendancePresent: number;
  attendanceLate: number;
  attendanceAbsent: number;
  payrollRecords: number;
  totalPayout: number;
  pendingPayrollEmployees: number;
  hikeRequests: number;
  approvedLeaveDaysTotal: number;
  employeesWithLeaveDeduction: number;
  leaveDeductionTotal: number;
  leaveExcessDaysTotal: number;
  recentPayrollRows: Payroll[];
};

export type PayrollSubviewKey =
  | "run_payroll"
  | "compensation_adjustments"
  | "secure_vault";

export type PayrollSubview = {
  key: PayrollSubviewKey;
  title: string;
  description: string;
  href: string;
  stat: string;
  visible: boolean;
  adminOnly: boolean;
};

export function toDateKey(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function toMonthKey(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function toTimestampMs(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function isActiveUser(user: UserDoc) {
  const status = (user.status ?? "").toLowerCase();
  if (status === "inactive" || status === "terminated") return false;
  return user.isActive !== false;
}

function isOnLeavePresence(row: PresenceDoc) {
  const status = (row.status ?? "").toLowerCase();
  const dayStatus = (row.dayStatus ?? "").toLowerCase();
  return status === "on_leave" || dayStatus === "on_leave";
}

function isPresentPresence(row: PresenceDoc) {
  const status = (row.status ?? "").toLowerCase();
  const dayStatus = (row.dayStatus ?? "").toLowerCase();
  if (isOnLeavePresence(row)) return false;
  return (
    status === "checked_in" ||
    status === "checked_out" ||
    status === "on_break" ||
    status === "present" ||
    dayStatus === "present" ||
    dayStatus === "late"
  );
}

function isLatePresence(row: PresenceDoc) {
  return (row.dayStatus ?? "").toLowerCase() === "late";
}

export function createEmptyPeoplePayrollSnapshot(input?: {
  dateKey?: string;
  monthKey?: string;
}): PeoplePayrollSnapshot {
  return {
    dateKey: input?.dateKey ?? toDateKey(),
    monthKey: input?.monthKey ?? toMonthKey(),
    activeEmployees: 0,
    activeCandidates: 0,
    payrollReadyEmployees: 0,
    pendingLeavesTotal: 0,
    pendingLeavesScoped: 0,
    onLeaveTodayTotal: 0,
    onLeaveTodayScoped: 0,
    attendancePresent: 0,
    attendanceLate: 0,
    attendanceAbsent: 0,
    payrollRecords: 0,
    totalPayout: 0,
    pendingPayrollEmployees: 0,
    hikeRequests: 0,
    approvedLeaveDaysTotal: 0,
    employeesWithLeaveDeduction: 0,
    leaveDeductionTotal: 0,
    leaveExcessDaysTotal: 0,
    recentPayrollRows: [],
  };
}

export async function fetchPeoplePayrollSnapshot(input: {
  currentUser: UserDoc | null;
  dateKey?: string;
  monthKey?: string;
}): Promise<PeoplePayrollSnapshot> {
  const firestore = db;
  if (!firestore) throw new Error("Firebase is not configured");

  const dateKey = input.dateKey ?? toDateKey();
  const monthKey = input.monthKey ?? toMonthKey();
  const currentUser = input.currentUser;
  const role = normalizeRoleValue(currentUser?.orgRole ?? currentUser?.role);
  const isHr = role === "HR";

  const usersPromise = getDocs(query(collection(firestore, "users"), limit(1500)));
  const leavesPromise = getDocs(
    query(
      collection(firestore, "leaveRequests"),
      where("status", "in", ["pending", "pending_hr", "pending_manager"]),
      limit(1200),
    ),
  );
  const approvedLeavesPromise = getDocs(
    query(collection(firestore, "leaveRequests"), where("status", "==", "approved"), limit(2000)),
  );
  const presencePromise = getDocs(
    query(collection(firestore, "presence"), where("dateKey", "==", dateKey), limit(1500)),
  );
  const payrollPromise = getDocs(
    query(collection(firestore, "payroll"), where("month", "==", monthKey)),
  );
  const hikePromise = getDocs(query(collection(firestore, "hike_requests"), limit(1200)));
  const candidateCountPromise = getCountFromServer(
    query(collection(firestore, "candidates"), where("status", "!=", "Rejected")),
  ).catch(() => ({ data: () => ({ count: 0 }) }));

  const [
    usersSnap,
    leavesSnap,
    approvedLeavesSnap,
    presenceSnap,
    payrollSnap,
    hikeSnap,
    candidateCountSnap,
  ] =
    await Promise.all([
      usersPromise,
      leavesPromise,
      approvedLeavesPromise,
      presencePromise,
      payrollPromise,
      hikePromise,
      candidateCountPromise,
    ]);

  const users = usersSnap.docs.map((row) => ({ ...(row.data() as UserDoc), uid: row.id }));
  const activeUsers = users.filter(isActiveUser);
  const usersByUid = new Map(activeUsers.map((user) => [user.uid, user] as const));

  const leaveRows = leavesSnap.docs.map((row) => row.data() as LeaveRequestDoc);
  const approvedLeaveRows = approvedLeavesSnap.docs.map((row) => row.data() as LeaveRequestDoc);
  const pendingLeavesTotal = leaveRows.length;
  const pendingLeavesScoped = isHr
    ? leaveRows.filter((row) => row.assignedHR === currentUser?.uid).length
    : pendingLeavesTotal;

  const presenceRows = presenceSnap.docs.map((row) => row.data() as PresenceDoc);
  const onLeaveTodayTotal = presenceRows.filter(isOnLeavePresence).length;
  const onLeaveTodayScoped = isHr
    ? presenceRows.filter((row) => {
        const employee = usersByUid.get(row.uid);
        return employee?.assignedHR === currentUser?.uid && isOnLeavePresence(row);
      }).length
    : onLeaveTodayTotal;
  const attendancePresent = presenceRows.filter(isPresentPresence).length;
  const attendanceLate = presenceRows.filter(isLatePresence).length;
  const attendanceAbsent = Math.max(
    0,
    activeUsers.length - attendancePresent - onLeaveTodayTotal,
  );

  const payrollRows = payrollSnap.docs.map(
    (row) => ({ ...(row.data() as Payroll), id: row.id }) as Payroll,
  );
  const totalPayout = payrollRows.reduce(
    (sum, row) => sum + Number(row.netSalary || 0),
    0,
  );
  const payrollReadyEmployees = activeUsers.filter(
    (user) => Number(user.salaryStructure?.base || 0) > 0,
  ).length;
  const pendingPayrollEmployees = Math.max(0, payrollReadyEmployees - payrollRows.length);
  const recentPayrollRows = [...payrollRows]
    .sort((left, right) => toTimestampMs(right.generatedAt) - toTimestampMs(left.generatedAt))
    .slice(0, 8);

  const hikeRequests = hikeSnap.docs
    .map((row) => row.data() as HikeRequestDocLite)
    .filter((row) => (row.status ?? "").toUpperCase() === "PENDING").length;

  const approvedLeaveByUid = buildMonthlyApprovedLeaveSummaryByUser(approvedLeaveRows, monthKey);
  const approvedLeaveDaysTotal = Object.values(approvedLeaveByUid).reduce(
    (sum, row) => sum + row.chargeableLeaveDays,
    0,
  );

  let employeesWithLeaveDeduction = 0;
  let leaveDeductionTotal = 0;
  let leaveExcessDaysTotal = 0;
  Object.entries(approvedLeaveByUid).forEach(([uid, summary]) => {
    const employee = usersByUid.get(uid);
    const baseSalary = Number(employee?.salaryStructure?.base || 0);
    const leaveImpact = calculateMonthlyLeaveDeduction({
      approvedChargeableDays: summary.chargeableLeaveDays,
      baseSalary,
    });
    if (leaveImpact.excessLeaveDays > 0) {
      employeesWithLeaveDeduction += 1;
      leaveDeductionTotal += leaveImpact.deductionAmount;
      leaveExcessDaysTotal += leaveImpact.excessLeaveDays;
    }
  });

  return {
    dateKey,
    monthKey,
    activeEmployees: activeUsers.length,
    activeCandidates: candidateCountSnap.data().count,
    payrollReadyEmployees,
    pendingLeavesTotal,
    pendingLeavesScoped,
    onLeaveTodayTotal,
    onLeaveTodayScoped,
    attendancePresent,
    attendanceLate,
    attendanceAbsent,
    payrollRecords: payrollRows.length,
    totalPayout,
    pendingPayrollEmployees,
    hikeRequests,
    approvedLeaveDaysTotal,
    employeesWithLeaveDeduction,
    leaveDeductionTotal,
    leaveExcessDaysTotal,
    recentPayrollRows,
  };
}

export function usePeoplePayrollSnapshot(
  currentUser: UserDoc | null,
  options?: {
    dateKey?: string;
    monthKey?: string;
    refreshMs?: number;
  },
) {
  const dateKey = options?.dateKey ?? toDateKey();
  const monthKey = options?.monthKey ?? toMonthKey();
  const refreshMs = options?.refreshMs ?? 60_000;
  const [snapshot, setSnapshot] = useState<PeoplePayrollSnapshot>(() =>
    createEmptyPeoplePayrollSnapshot({ dateKey, monthKey }),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setSnapshot(createEmptyPeoplePayrollSnapshot({ dateKey, monthKey }));
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const loadSnapshot = async (showLoader: boolean) => {
      if (showLoader) setLoading(true);
      try {
        const next = await fetchPeoplePayrollSnapshot({
          currentUser,
          dateKey,
          monthKey,
        });
        if (!active) return;
        setSnapshot(next);
        setError(null);
      } catch (loadError: unknown) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError
            : new Error("Unable to load people/payroll snapshot"),
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadSnapshot(true);
    if (refreshMs > 0) {
      timer = setInterval(() => {
        void loadSnapshot(false);
      }, refreshMs);
    }

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [
    currentUser,
    currentUser?.uid,
    currentUser?.role,
    currentUser?.orgRole,
    dateKey,
    monthKey,
    refreshMs,
  ]);

  return {
    snapshot,
    loading,
    error,
  };
}

export function getPayrollSubviews(
  currentUser: UserDoc | null,
  snapshot?: PeoplePayrollSnapshot | null,
): PayrollSubview[] {
  const adminOnly = isAdminUser(currentUser);
  const payrollRecordsLabel = snapshot
    ? `${snapshot.payrollRecords} records this month`
    : "Monthly payroll run";
  const hikeRequestsLabel = snapshot
    ? `${snapshot.hikeRequests} pending hike requests`
    : "Compensation approvals";

  const subviews: PayrollSubview[] = [
    {
      key: "run_payroll",
      title: "Run Payroll",
      description: "Monthly payroll generation, edits, and payslip downloads.",
      href: "/hr/payroll",
      stat: payrollRecordsLabel,
      visible: true,
      adminOnly: false,
    },
    {
      key: "compensation_adjustments",
      title: "Compensation & Adjustments",
      description: "Salary structure, one-time bonus dispatch, and hike approvals.",
      href: "/super-admin/payroll",
      stat: hikeRequestsLabel,
      visible: adminOnly,
      adminOnly: true,
    },
    {
      key: "secure_vault",
      title: "Secure Vault",
      description: "Restricted salary and bank detail access for secure review.",
      href: "/admin/payroll/vault",
      stat: "Restricted access",
      visible: adminOnly,
      adminOnly: true,
    },
  ];

  return subviews.filter((subview) => subview.visible);
}

export function getPayrollScopeLabel(currentUser: UserDoc | null) {
  if (!currentUser) return "Role scope loading";
  return isAdminUser(currentUser)
    ? "Admin scope | all payroll subviews enabled"
    : "HR scope | payroll run subview enabled";
}
