import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { normalizeRoleValue } from "@/lib/access";
import { buildMonthlyApprovedLeaveSummaryByUser } from "@/lib/attendance/leave-policy";
import { getDefaultPayrollCycle, normalizePayrollRecord } from "@/lib/payroll/payslip";
import type { AttendanceDayDoc, LeaveRequestDoc } from "@/lib/types/attendance";
import type { Payroll, PayrollLineItem } from "@/lib/types/hr";
import type {
  AttendanceRecord,
  BulkGeneratePayrollResponse,
  GeneratePayrollRequest,
  PayrollDetailsResponse,
  PayrollEmployeeRecord,
  PayrollListItem,
  PayrollListResponse,
} from "@/lib/types/payroll";
import type { UserDoc } from "@/lib/types/user";

const PAYROLL_MONTH_DAYS = 30;

export class PayrollServiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PayrollServiceError";
    this.status = status;
  }
}

function isValidMonthKey(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function normalizeMonthKey(value: string) {
  const normalized = value.trim();
  if (!isValidMonthKey(normalized)) {
    throw new PayrollServiceError("Month must be in YYYY-MM format.", 400);
  }
  return normalized;
}

function roundCurrency(value: number) {
  return Math.round(Number(value) || 0);
}

function readNamedAmount(
  items: Array<{ label: string; amount: number }> | null | undefined,
  labels: string[],
) {
  if (!items?.length) return undefined;
  const expected = new Set(labels.map((label) => label.trim().toLowerCase()));
  let matched = false;
  const total = items.reduce((sum, item) => {
    const key = String(item.label ?? "").trim().toLowerCase();
    if (!expected.has(key)) return sum;
    matched = true;
    return sum + roundCurrency(item.amount);
  }, 0);
  return matched ? total : undefined;
}

function formatIsoDate(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  return null;
}

function getMonthWindow(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 0));
  const startKey = `${month}-01`;
  const endKey = `${month}-${String(end.getUTCDate()).padStart(2, "0")}`;

  return {
    year: String(year),
    monthNumber,
    monthToken: String(monthNumber).padStart(2, "0"),
    start,
    end,
    startKey,
    endKey,
  };
}

function getDisplayName(user: UserDoc) {
  return user.displayName?.trim() || user.name?.trim() || user.email?.trim() || user.uid;
}

function getEmployeeSalary(user: UserDoc) {
  return Math.max(0, Number(user.salary ?? user.payroll?.baseSalary ?? user.salaryStructure?.base ?? 0));
}

function isActivePayrollUser(user: UserDoc) {
  const status = String(user.status ?? "").toLowerCase();
  if (status === "inactive" || status === "terminated") return false;
  return normalizeRoleValue(user.orgRole ?? user.role) !== "SUPER_ADMIN";
}

function buildEmployeeRecord(user: UserDoc): PayrollEmployeeRecord {
  return {
    id: user.uid,
    uid: user.uid,
    name: getDisplayName(user),
    employeeId: user.employeeId?.trim() || user.uid,
    designation: user.designation?.trim() || null,
    department: user.department?.trim() || null,
    salary: getEmployeeSalary(user),
    joiningDate: formatIsoDate(user.joiningDate),
  };
}

function buildPayrollDocId(uid: string, month: string) {
  return `${uid}_${month}`;
}

function getRecurringPayrollComponents(user: UserDoc) {
  const salaryEarnings = user.salaryStructure?.earnings;
  const salaryDeductions = user.salaryStructure?.deductions;

  const studyAllowance = roundCurrency(
    user.salaryStructure?.studyAllowance ??
      readNamedAmount(salaryEarnings, ["study allowance", "study allowance ", "travel", "travel allowance"]) ??
      user.payroll?.allowances?.travel ??
      0,
  );
  const hra = roundCurrency(
    user.salaryStructure?.hra ??
      readNamedAmount(salaryEarnings, ["hra", "house rent allowance"]) ??
      user.payroll?.allowances?.hra ??
      0,
  );
  const recurringBonus = roundCurrency(
    readNamedAmount(salaryEarnings, ["performance bonus", "bonus"]) ??
      user.payroll?.allowances?.bonus ??
      0,
  );
  const professionalTax = roundCurrency(
    user.salaryStructure?.professionalTax ??
      readNamedAmount(salaryDeductions, ["professional tax", "pt"]) ??
      user.payroll?.deductions?.professionalTax ??
      0,
  );
  const pf = roundCurrency(
    user.salaryStructure?.pf ??
      readNamedAmount(salaryDeductions, ["pf", "provident fund"]) ??
      user.payroll?.deductions?.pf ??
      0,
  );
  const insurance = roundCurrency(
    user.salaryStructure?.insurance ??
      readNamedAmount(salaryDeductions, ["health insurance", "insurance"]) ??
      user.payroll?.deductions?.insurance ??
      0,
  );

  return {
    studyAllowance,
    hra,
    recurringBonus,
    professionalTax,
    pf,
    insurance,
  };
}

function getDefaultPayrollComponents(user: UserDoc) {
  const components = getRecurringPayrollComponents(user);

  return {
    earnings: {
      basicSalary: roundCurrency(getEmployeeSalary(user)),
      studyAllowance: components.studyAllowance,
      bonus: components.recurringBonus,
      hra: components.hra,
    },
    deductionBreakdown: {
      lop: 0,
      professionalTax: components.professionalTax,
      pf: components.pf,
      insurance: components.insurance,
    },
  };
}

function enrichPayrollFromUser(payroll: Payroll, user: UserDoc) {
  const components = getRecurringPayrollComponents(user);
  const existingEarnings = !Array.isArray(payroll.earnings) ? payroll.earnings : undefined;
  const existingDeductions = payroll.deductionBreakdown;
  const lop = roundCurrency(
    existingDeductions?.lop ??
      Math.max(0, Number(payroll.deductions ?? 0) - components.professionalTax - components.pf - components.insurance),
  );

  return normalizePayrollRecord({
    ...payroll,
    earnings: {
      basicSalary: roundCurrency(
        existingEarnings?.basicSalary ?? payroll.basicSalary ?? payroll.baseSalary ?? getEmployeeSalary(user),
      ),
      studyAllowance: roundCurrency(existingEarnings?.studyAllowance ?? components.studyAllowance),
      bonus: roundCurrency(
        existingEarnings?.bonus ?? payroll.bonus ?? payroll.bonuses ?? payroll.incentives ?? components.recurringBonus,
      ),
      hra: roundCurrency(existingEarnings?.hra ?? components.hra),
    },
    deductionBreakdown: {
      lop,
      professionalTax: roundCurrency(existingDeductions?.professionalTax ?? components.professionalTax),
      pf: roundCurrency(existingDeductions?.pf ?? components.pf),
      insurance: roundCurrency(existingDeductions?.insurance ?? components.insurance),
    },
  });
}

async function findPayrollRecord(
  adminDb: Firestore,
  input: {
    employee: PayrollEmployeeRecord;
    month: string;
    payrollId?: string;
  },
) {
  const requestedPayrollId = input.payrollId?.trim();
  if (requestedPayrollId) {
    const directSnap = await adminDb.collection("payroll").doc(requestedPayrollId).get();
    if (directSnap.exists) {
      return directSnap;
    }
  }

  const canonicalPayrollId = buildPayrollDocId(input.employee.uid, input.month);
  const canonicalSnap = await adminDb.collection("payroll").doc(canonicalPayrollId).get();
  if (canonicalSnap.exists) {
    return canonicalSnap;
  }

  const uidMatches = await adminDb
    .collection("payroll")
    .where("month", "==", input.month)
    .where("uid", "==", input.employee.uid)
    .limit(1)
    .get();

  if (!uidMatches.empty) {
    return uidMatches.docs[0];
  }

  const employeeId = input.employee.employeeId?.trim();
  if (employeeId) {
    const employeeIdMatches = await adminDb
      .collection("payroll")
      .where("month", "==", input.month)
      .where("employeeId", "==", employeeId)
      .limit(1)
      .get();

    if (!employeeIdMatches.empty) {
      return employeeIdMatches.docs[0];
    }
  }

  return null;
}

async function ensurePayrollCanGenerate(
  adminDb: Firestore,
  employee: UserDoc,
  month: string,
) {
  const employeeRecord = buildEmployeeRecord(employee);

  if (!isActivePayrollUser(employee)) {
    throw new PayrollServiceError("Employee is not active for payroll.", 409);
  }

  if (employeeRecord.salary <= 0) {
    throw new PayrollServiceError("Employee salary is zero. Update salary before payroll generation.", 422);
  }

  const payrollId = buildPayrollDocId(employee.uid, month);
  const payrollRef = adminDb.collection("payroll").doc(payrollId);
  const existingSnap = await payrollRef.get();
  if (existingSnap.exists) {
    throw new PayrollServiceError("Payroll already generated for this employee and month.", 409);
  }

  return {
    employeeRecord,
    payrollRef,
  };
}

async function resolveEmployeeByKey(adminDb: Firestore, employeeKey: string) {
  const key = employeeKey.trim();
  if (!key) {
    throw new PayrollServiceError("Employee id is required.", 400);
  }

  const directSnap = await adminDb.collection("users").doc(key).get();
  if (directSnap.exists) {
    return {
      ...(directSnap.data() as UserDoc),
      uid: directSnap.id,
    } satisfies UserDoc;
  }

  const employeeIdSnap = await adminDb
    .collection("users")
    .where("employeeId", "==", key)
    .limit(1)
    .get();

  if (employeeIdSnap.empty) {
    throw new PayrollServiceError("Employee not found.", 404);
  }

  const row = employeeIdSnap.docs[0];
  return {
    ...(row.data() as UserDoc),
    uid: row.id,
  } satisfies UserDoc;
}

async function loadApprovedLeaves(adminDb: Firestore, uid: string, month: string) {
  const { start, end } = getMonthWindow(month);
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

async function loadAttendanceRecord(
  adminDb: Firestore,
  employee: PayrollEmployeeRecord,
  month: string,
): Promise<AttendanceRecord> {
  const window = getMonthWindow(month);
  const daysSnap = await adminDb
    .collection("users")
    .doc(employee.uid)
    .collection("attendance")
    .doc(window.year)
    .collection("months")
    .doc(window.monthToken)
    .collection("days")
    .get();

  if (daysSnap.empty) {
    throw new PayrollServiceError(
      `Attendance is missing for ${employee.name} in ${month}.`,
      422,
    );
  }

  const days = daysSnap.docs.map((row) => row.data() as AttendanceDayDoc);
  const approvedLeaves = await loadApprovedLeaves(adminDb, employee.uid, month);
  const leaveSummaryByUid = buildMonthlyApprovedLeaveSummaryByUser(approvedLeaves, month);
  const approvedLeaveDays = leaveSummaryByUid[employee.uid]?.chargeableLeaveDays ?? 0;

  const daysPresent = days.filter((day) => {
    const dayStatus = String(day.dayStatus ?? "").toLowerCase();
    const status = String(day.status ?? "").toLowerCase();
    return (
      dayStatus === "present" ||
      dayStatus === "late" ||
      status === "checked_in" ||
      status === "checked_out" ||
      status === "on_break"
    );
  }).length;

  const lateCount = days.filter((day) => String(day.dayStatus ?? "").toLowerCase() === "late").length;
  const explicitAbsent = days.filter((day) => {
    const dayStatus = String(day.dayStatus ?? "").toLowerCase();
    const status = String(day.status ?? "").toLowerCase();
    return dayStatus === "absent" || status === "absent";
  }).length;

  const daysAbsent =
    explicitAbsent > 0
      ? explicitAbsent
      : Math.max(0, PAYROLL_MONTH_DAYS - daysPresent - approvedLeaveDays);

  return {
    employeeId: employee.employeeId,
    uid: employee.uid,
    month,
    daysPresent,
    daysAbsent,
    lateCount,
    leavesApproved: approvedLeaveDays,
  };
}

async function hasAttendanceForMonth(
  adminDb: Firestore,
  employeeUid: string,
  month: string,
) {
  const window = getMonthWindow(month);
  const snapshot = await adminDb
    .collection("users")
    .doc(employeeUid)
    .collection("attendance")
    .doc(window.year)
    .collection("months")
    .doc(window.monthToken)
    .collection("days")
    .limit(1)
    .get();

  return !snapshot.empty;
}

function buildPayrollRecord(input: {
  employee: PayrollEmployeeRecord;
  user: UserDoc;
  attendance: AttendanceRecord;
  month: string;
  bonus: number;
}): Payroll {
  const basicSalary = roundCurrency(input.employee.salary);
  const components = getRecurringPayrollComponents(input.user);
  const perDaySalary = basicSalary / PAYROLL_MONTH_DAYS;
  const lop = roundCurrency(perDaySalary * input.attendance.daysAbsent);
  const bonuses = roundCurrency(components.recurringBonus + Number(input.bonus ?? 0));
  const totalEarnings = roundCurrency(basicSalary + components.studyAllowance + bonuses + components.hra);
  const totalDeductions = roundCurrency(
    lop + components.professionalTax + components.pf + components.insurance,
  );
  const netPay = Math.max(0, roundCurrency(totalEarnings - totalDeductions));
  const now = new Date();
  const payrollCycle = getDefaultPayrollCycle(input.month);
  const payrollId = buildPayrollDocId(input.employee.uid, input.month);

  return {
    id: payrollId,
    uid: input.employee.uid,
    employeeId: input.employee.employeeId,
    month: input.month,
    basicSalary,
    baseSalary: basicSalary,
    daysPresent: input.attendance.daysPresent,
    daysAbsent: input.attendance.daysAbsent,
    lates: input.attendance.lateCount,
    lateCount: input.attendance.lateCount,
    incentives: bonuses,
    bonus: bonuses,
    bonuses,
    deductions: totalDeductions,
    leaveApprovedDays: input.attendance.leavesApproved,
    netPay,
    netSalary: netPay,
    status: "GENERATED",
    generatedAt: now,
    userDisplayName: input.employee.name,
    userEmail: input.user.email ?? undefined,
    designation: input.employee.designation ?? undefined,
    department: input.employee.department ?? undefined,
    joiningDate: input.employee.joiningDate,
    grossSalary: totalEarnings,
    paymentPeriodStart: payrollCycle?.start ?? null,
    paymentPeriodEnd: payrollCycle?.end ?? null,
    paymentDate: payrollCycle?.paymentDate ?? now.toISOString().slice(0, 10),
    earnings: {
      basicSalary,
      studyAllowance: components.studyAllowance,
      bonus: bonuses,
      hra: components.hra,
    },
    deductionBreakdown: {
      lop,
      professionalTax: components.professionalTax,
      pf: components.pf,
      insurance: components.insurance,
    },
    deductionItems: [
      { label: "LOP (Loss of Pay)", amount: lop },
      { label: "Professional Tax", amount: components.professionalTax },
      { label: "PF", amount: components.pf },
      { label: "Health Insurance", amount: components.insurance },
    ],
  };
}

export async function generatePayrollRecord(
  adminDb: Firestore,
  input: GeneratePayrollRequest,
) {
  const month = normalizeMonthKey(input.month);
  const employee = await resolveEmployeeByKey(adminDb, input.employeeId);
  const { employeeRecord, payrollRef } = await ensurePayrollCanGenerate(adminDb, employee, month);

  const attendance = await loadAttendanceRecord(adminDb, employeeRecord, month);
  const payroll = buildPayrollRecord({
    employee: employeeRecord,
    user: employee,
    attendance,
    month,
    bonus: Number(input.bonus ?? 0),
  });

  await payrollRef.set({
    ...payroll,
    generatedAt: FieldValue.serverTimestamp(),
  });

  return {
    employee: employeeRecord,
    attendance,
    payroll,
    defaultComponents: getDefaultPayrollComponents(employee),
  } satisfies PayrollDetailsResponse;
}

export async function generatePayrollBatch(
  adminDb: Firestore,
  monthInput: string,
): Promise<BulkGeneratePayrollResponse> {
  const month = normalizeMonthKey(monthInput);
  const [usersSnap, payrollSnap] = await Promise.all([
    adminDb.collection("users").where("status", "==", "active").get(),
    adminDb.collection("payroll").where("month", "==", month).get(),
  ]);

  const existingPayrollUids = new Set(
    payrollSnap.docs.map((row) => String((row.data() as Payroll).uid ?? "")),
  );

  const activeEmployees = usersSnap.docs
    .map((row) => ({ ...(row.data() as UserDoc), uid: row.id }))
    .filter((user) => normalizeRoleValue(user.orgRole ?? user.role) !== "SUPER_ADMIN");

  const results: BulkGeneratePayrollResponse["results"] = [];
  const summary: BulkGeneratePayrollResponse["summary"] = {
    attempted: activeEmployees.length,
    generated: 0,
    alreadyGenerated: 0,
    missingAttendance: 0,
    zeroSalary: 0,
    inactive: 0,
    failed: 0,
  };

  for (const employee of activeEmployees) {
    const employeeRecord = buildEmployeeRecord(employee);

    if (!isActivePayrollUser(employee)) {
      summary.inactive += 1;
      results.push({
        employeeId: employeeRecord.employeeId,
        uid: employee.uid,
        name: employeeRecord.name,
        status: "INACTIVE",
        message: "Employee is inactive for payroll.",
      });
      continue;
    }

    if (existingPayrollUids.has(employee.uid)) {
      summary.alreadyGenerated += 1;
      results.push({
        employeeId: employeeRecord.employeeId,
        uid: employee.uid,
        name: employeeRecord.name,
        status: "ALREADY_GENERATED",
        message: "Payroll already exists for this month.",
      });
      continue;
    }

    if (employeeRecord.salary <= 0) {
      summary.zeroSalary += 1;
      results.push({
        employeeId: employeeRecord.employeeId,
        uid: employee.uid,
        name: employeeRecord.name,
        status: "ZERO_SALARY",
        message: "Salary is zero or missing.",
      });
      continue;
    }

    try {
      const { payrollRef } = await ensurePayrollCanGenerate(adminDb, employee, month);
      const attendance = await loadAttendanceRecord(adminDb, employeeRecord, month);
      const payroll = buildPayrollRecord({
        employee: employeeRecord,
        user: employee,
        attendance,
        month,
        bonus: 0,
      });

      await payrollRef.set({
        ...payroll,
        generatedAt: FieldValue.serverTimestamp(),
      });

      existingPayrollUids.add(employee.uid);
      summary.generated += 1;
      results.push({
        employeeId: employeeRecord.employeeId,
        uid: employee.uid,
        name: employeeRecord.name,
        status: "GENERATED",
        message: "Payroll generated successfully.",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to generate payroll.";
      const status = error instanceof PayrollServiceError ? error.status : 500;

      if (status === 422 && message.toLowerCase().includes("attendance")) {
        summary.missingAttendance += 1;
        results.push({
          employeeId: employeeRecord.employeeId,
          uid: employee.uid,
          name: employeeRecord.name,
          status: "MISSING_ATTENDANCE",
          message,
        });
        continue;
      }

      if (status === 409 && message.toLowerCase().includes("already generated")) {
        summary.alreadyGenerated += 1;
        results.push({
          employeeId: employeeRecord.employeeId,
          uid: employee.uid,
          name: employeeRecord.name,
          status: "ALREADY_GENERATED",
          message,
        });
        continue;
      }

      if (status === 422 && message.toLowerCase().includes("salary is zero")) {
        summary.zeroSalary += 1;
        results.push({
          employeeId: employeeRecord.employeeId,
          uid: employee.uid,
          name: employeeRecord.name,
          status: "ZERO_SALARY",
          message,
        });
        continue;
      }

      summary.failed += 1;
      results.push({
        employeeId: employeeRecord.employeeId,
        uid: employee.uid,
        name: employeeRecord.name,
        status: "FAILED",
        message,
      });
    }
  }

  return {
    month,
    summary,
    results,
  };
}

export async function getPayrollDetails(
  adminDb: Firestore,
  employeeKey: string,
  monthInput: string,
  options?: {
    payrollId?: string;
  },
): Promise<PayrollDetailsResponse> {
  const month = normalizeMonthKey(monthInput);
  const employee = await resolveEmployeeByKey(adminDb, employeeKey);
  const employeeRecord = buildEmployeeRecord(employee);
  const payrollSnap = await findPayrollRecord(adminDb, {
    employee: employeeRecord,
    month,
    payrollId: options?.payrollId,
  });

  if (!payrollSnap) {
    throw new PayrollServiceError("Payroll record not found.", 404);
  }

  const payroll = enrichPayrollFromUser({
    ...(payrollSnap.data() as Payroll),
    id: payrollSnap.id,
  }, employee);
  const attendance = await loadAttendanceRecord(adminDb, employeeRecord, month);

  return {
    employee: {
      ...employeeRecord,
      designation: employeeRecord.designation ?? payroll.designation ?? null,
      department: employeeRecord.department ?? payroll.department ?? null,
    },
    attendance,
    payroll,
    defaultComponents: getDefaultPayrollComponents(employee),
  };
}

export async function listPayrollForMonth(
  adminDb: Firestore,
  monthInput: string,
): Promise<PayrollListResponse> {
  const month = normalizeMonthKey(monthInput);
  const [usersSnap, payrollSnap] = await Promise.all([
    adminDb.collection("users").where("status", "==", "active").get(),
    adminDb.collection("payroll").where("month", "==", month).get(),
  ]);

  const users = usersSnap.docs
    .map((row) => ({ ...(row.data() as UserDoc), uid: row.id }));
  const userByUid = new Map(users.map((user) => [user.uid, user]));

  const employees = users
    .filter(isActivePayrollUser)
    .map((user) => buildEmployeeRecord(user))
    .sort((left, right) => left.name.localeCompare(right.name));

  const payrollByUid = new Map(
    payrollSnap.docs.map((row) => [
      String((row.data() as Payroll).uid ?? ""),
      {
        ...(row.data() as Payroll),
        id: row.id,
      } satisfies Payroll,
    ]),
  );

  const items: PayrollListItem[] = await Promise.all(employees.map(async (employee) => {
    const payrollSource = payrollByUid.get(employee.uid) ?? null;
    const employeeUser = userByUid.get(employee.uid);
    const payroll = payrollSource && employeeUser
      ? enrichPayrollFromUser(payrollSource, employeeUser)
      : payrollSource
        ? normalizePayrollRecord(payrollSource)
        : null;

    if (payroll) {
      return {
        employee,
        payroll,
        status: payroll.status === "PENDING_CREATION" ? "NOT_GENERATED" : payroll.status,
        issue: null,
      };
    }

    if (employee.salary <= 0) {
      return {
        employee,
        payroll: null,
        status: "ZERO_SALARY",
        issue: "Salary is zero or missing.",
      };
    }

    const attendanceAvailable = await hasAttendanceForMonth(adminDb, employee.uid, month);
    if (!attendanceAvailable) {
      return {
        employee,
        payroll: null,
        status: "MISSING_ATTENDANCE",
        issue: "Attendance is missing for this month.",
      };
    }

    return {
      employee,
      payroll: null,
      status: "NOT_GENERATED",
      issue: null,
    };
  }));

  return {
    month,
    summary: {
      totalEmployees: items.length,
      totalPayout: items.reduce((sum, item) => sum + Number(item.payroll?.netPay ?? item.payroll?.netSalary ?? 0), 0),
      payrollRecords: items.filter((item) => item.payroll).length,
    },
    items,
  };
}

export async function resolvePayrollOwnership(
  adminDb: Firestore,
  employeeKey: string,
  requester: Pick<UserDoc, "uid" | "employeeId">,
) {
  const employee = await resolveEmployeeByKey(adminDb, employeeKey);
  return employee.uid === requester.uid || employee.employeeId === requester.employeeId;
}
