import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import {
  buildMonthlyApprovedLeaveSummaryByUser,
  calculateMonthlyLeaveDeduction,
} from "@/lib/attendance/leave-policy";
import { isPresentAttendanceRecord } from "@/lib/attendance/status";
import {
  calculateActiveMinutes,
  getAttendanceSessionCount,
} from "@/lib/attendance-utils";
import type { AttendanceDayDoc, LeaveRequestDoc } from "@/lib/types/attendance";
import type { AttendanceRecord } from "@/lib/types/payroll";

export const PAYROLL_MONTH_DAYS = 30;

export function getPayrollMonthWindow(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0));

  return {
    year: String(year),
    monthToken: String(monthNumber).padStart(2, "0"),
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end,
  };
}

async function loadApprovedLeaves(adminDb: Firestore, uid: string, month: string) {
  const { start, end } = getPayrollMonthWindow(month);
  const snap = await adminDb
    .collection("leaveRequests")
    .where("uid", "==", uid)
    .where("status", "==", "approved")
    .get();

  return snap.docs
    .map((row) => row.data() as LeaveRequestDoc)
    .filter((request) => {
      const startDate = request.startDateKey ? new Date(`${request.startDateKey}T00:00:00Z`) : null;
      const endDate = request.endDateKey ? new Date(`${request.endDateKey}T00:00:00Z`) : null;
      if (!startDate || !endDate) return false;
      return startDate <= end && endDate >= start;
    });
}

export async function loadPayrollAttendanceSummary(
  adminDb: Firestore,
  input: {
    employeeId: string;
    uid: string;
    month: string;
    baseSalary: number;
  },
): Promise<AttendanceRecord | null> {
  const window = getPayrollMonthWindow(input.month);
  const daysSnap = await adminDb
    .collection("users")
    .doc(input.uid)
    .collection("attendance")
    .doc(window.year)
    .collection("months")
    .doc(window.monthToken)
    .collection("days")
    .get();

  if (daysSnap.empty) {
    return null;
  }

  const days = daysSnap.docs.map((row) => row.data() as AttendanceDayDoc);
  const approvedLeaves = await loadApprovedLeaves(adminDb, input.uid, input.month);
  const leaveSummaryByUid = buildMonthlyApprovedLeaveSummaryByUser(approvedLeaves, input.month);
  const leaveSummary = leaveSummaryByUid[input.uid];
  const leaveImpact = calculateMonthlyLeaveDeduction({
    approvedChargeableDays: leaveSummary?.chargeableLeaveDays ?? 0,
    baseSalary: input.baseSalary,
  });

  const daysPresent = days.filter((day) => isPresentAttendanceRecord(day)).length;
  const lateCount = days.filter((day) => String(day.dayStatus ?? "").toLowerCase() === "late").length;
  const explicitAbsentDays = days.filter((day) => {
    const dayStatus = String(day.dayStatus ?? "").toLowerCase();
    const status = String(day.status ?? "").toLowerCase();
    return dayStatus === "absent" || status === "absent";
  }).length;
  const attendanceCorrections = days.filter((day) => {
    const status = String((day as Record<string, unknown>).correctionStatus ?? "").toLowerCase();
    return status === "approved" || status === "rejected" || status === "pending_hr_review";
  });
  const attendanceCorrectionPendingCount = attendanceCorrections.filter(
    (day) =>
      String((day as Record<string, unknown>).correctionStatus ?? "").toLowerCase() ===
      "pending_hr_review",
  ).length;
  const attendanceCorrectionReasons = Array.from(
    new Set(
      attendanceCorrections
        .map((day) => {
          const value = (day as Record<string, unknown>).correctionReason;
          return typeof value === "string" ? value.trim() : "";
        })
        .filter(Boolean),
    ),
  ).slice(0, 5);
  const attendanceCorrectionSummary =
    attendanceCorrectionReasons.length > 0 ? attendanceCorrectionReasons.join(" | ") : null;
  const totalWorkedMinutes = days.reduce(
    (sum, day) => sum + calculateActiveMinutes(day),
    0,
  );
  const totalSessions = days.reduce(
    (sum, day) => sum + getAttendanceSessionCount(day),
    0,
  );
  const paidLeaveDays = Math.min(
    leaveImpact.approvedChargeableDays,
    leaveImpact.allowanceDays,
  );
  const payableDays = Math.min(PAYROLL_MONTH_DAYS, daysPresent + paidLeaveDays);
  const inferredAbsentDays = Math.max(0, PAYROLL_MONTH_DAYS - payableDays);
  const daysAbsent =
    explicitAbsentDays > 0
      ? Math.max(explicitAbsentDays, inferredAbsentDays)
      : inferredAbsentDays;

  return {
    employeeId: input.employeeId,
    uid: input.uid,
    month: input.month,
    daysPresent,
    daysAbsent,
    presentDays: daysPresent,
    absentDays: daysAbsent,
    halfDays: 0,
    overtimeHours: 0,
    lateCount,
    leavesApproved: leaveImpact.approvedChargeableDays,
    leaveDays: leaveImpact.approvedChargeableDays,
    paidLeaveDays,
    leaveAllowanceDays: leaveImpact.allowanceDays,
    leaveExcessDays: leaveImpact.excessLeaveDays,
    unpaidLeaveDays: leaveImpact.excessLeaveDays,
    totalWorkingDays: PAYROLL_MONTH_DAYS,
    workingDays: PAYROLL_MONTH_DAYS,
    payableDays,
    attendanceTrackedDays: days.length,
    explicitAbsentDays,
    totalWorkedMinutes,
    totalSessions,
    attendanceCorrectionCount: attendanceCorrections.length,
    attendanceCorrectionPendingCount,
    attendanceCorrectionReasons,
    attendanceCorrectionSummary,
  };
}
