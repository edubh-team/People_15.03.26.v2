import "server-only";

import type { DocumentSnapshot, Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { normalizeRoleValue } from "@/lib/access";
import { getDefaultPayrollCycle } from "@/lib/payroll/payslip";
import { loadPayrollAttendanceSummary } from "@/lib/server/payroll-attendance";
import type { Payroll } from "@/lib/types/hr";
import type {
  AttendanceOverrideInput,
  AttendanceRecord,
  BulkGeneratePayrollResponse,
  EmployeePayslipDetailsResponse,
  EmployeePayslipDownloadEvent,
  EmployeePayslipListItem,
  EmployeePayslipListResponse,
  EmployeePayslipRecord,
  GeneratePayrollRequest,
  PayrollActor,
  PayrollDetailsResponse,
  PayrollDownloadEvent,
  PayrollEmployeeRecord,
  PayrollListItem,
  PayrollListResponse,
  PayrollManualOverrides,
  PayrollRecord,
  PayrollSalaryBreakdown,
  PayrollVersionHistoryItem,
  SalaryOverrideInput,
  SalaryTemplate,
  SendPayslipRequest,
  SavePayrollRequest,
} from "@/lib/types/payroll";
import type { UserDoc } from "@/lib/types/user";

const PAYROLL_RECORDS = "payroll_records";
const PAYROLL_VERSIONS = "payroll_versions";
const SALARY_TEMPLATES = "salary_templates";
const ATTENDANCE_SUMMARY = "attendance_summary";
const EMPLOYEE_NOTIFICATIONS = "employee_notifications";
const EMPLOYEE_PAYSLIPS = "employee_payslips";
const LEGACY_PAYROLL = "payroll";

const PAYROLL_MONTH_REGEX = /^\d{4}-\d{2}$/;
const DEFAULT_WORKING_DAYS = 30;

export class PayrollServiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PayrollServiceError";
    this.status = status;
  }
}

function normalizeMonthKey(value: string) {
  const normalized = String(value ?? "").trim();
  if (!PAYROLL_MONTH_REGEX.test(normalized)) {
    throw new PayrollServiceError("Month must be in YYYY-MM format.", 400);
  }
  return normalized;
}

function roundCurrency(value: unknown) {
  return Math.round(Number(value) || 0);
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateString(value: unknown) {
  const parsed = toDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

function getDisplayName(user: Pick<UserDoc, "displayName" | "name" | "email" | "uid">) {
  return user.displayName?.trim() || user.name?.trim() || user.email?.trim() || user.uid;
}

function getEmployeeSalary(user: UserDoc) {
  return Math.max(
    0,
    Number(user.salary ?? user.payroll?.baseSalary ?? user.salaryStructure?.base ?? 0),
  );
}

function isActivePayrollUser(user: UserDoc) {
  const status = String(user.status ?? "").toLowerCase();
  if (status === "inactive" || status === "terminated") return false;
  return normalizeRoleValue(user.orgRole ?? user.role) !== "SUPER_ADMIN";
}

function buildActor(user: Pick<
  UserDoc,
  "uid" | "displayName" | "email" | "employeeId" | "role" | "orgRole"
>): PayrollActor {
  return {
    uid: user.uid,
    name: getDisplayName(user),
    employeeId: user.employeeId?.trim() || null,
    role: (user.orgRole ?? user.role ?? null) as string | null,
  };
}

function buildEmployeeRecord(user: UserDoc): PayrollEmployeeRecord {
  return {
    id: user.uid,
    uid: user.uid,
    name: getDisplayName(user),
    email: user.email ?? null,
    employeeId: user.employeeId?.trim() || user.uid,
    designation: user.designation?.trim() || null,
    department: user.department?.trim() || null,
    salary: getEmployeeSalary(user),
    joiningDate: toDateString(user.joiningDate),
  };
}

function buildPayrollDocId(uid: string, month: string) {
  return `${uid}_${month}`;
}

function buildPdfUrl(employeeId: string, month: string, payrollId: string) {
  const query = new URLSearchParams({ payrollId });
  return `/api/payroll/${encodeURIComponent(employeeId)}/${encodeURIComponent(month)}/pdf?${query.toString()}`;
}

function getPayrollMonthParts(month: string) {
  const normalized = normalizeMonthKey(month);
  const [yearText, monthText] = normalized.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  const monthName = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex - 1, 1)));

  return {
    month: normalized,
    year,
    monthIndex,
    monthName,
  };
}

function deriveSalaryTemplate(user: UserDoc, month: string, actor?: PayrollActor | null): SalaryTemplate {
  return {
    employeeId: user.employeeId?.trim() || user.uid,
    uid: user.uid,
    fixedMonthlySalary: getEmployeeSalary(user),
    baseSalary: getEmployeeSalary(user),
    incentive: 0,
    bonus: roundCurrency(user.payroll?.allowances?.bonus ?? 0),
    customAllowance: roundCurrency(user.payroll?.allowances?.travel ?? 0),
    hra: roundCurrency(user.salaryStructure?.hra ?? user.payroll?.allowances?.hra ?? 0),
    studyAllowance: roundCurrency(user.salaryStructure?.studyAllowance ?? 0),
    deduction: 0,
    advanceDeduction: 0,
    pf: roundCurrency(user.salaryStructure?.pf ?? user.payroll?.deductions?.pf ?? 0),
    tds: 0,
    professionalTax: roundCurrency(
      user.salaryStructure?.professionalTax ?? user.payroll?.deductions?.professionalTax ?? 0,
    ),
    insurance: roundCurrency(
      user.salaryStructure?.insurance ?? user.payroll?.deductions?.insurance ?? 0,
    ),
    autoRepeat: true,
    effectiveFromMonth: month,
    effectiveToMonth: null,
    updatedAt: null,
    updatedBy: actor ?? null,
  };
}

function mergeSalaryTemplate(template: SalaryTemplate, override?: SalaryOverrideInput | null): SalaryTemplate {
  if (!override) return template;

  return {
    ...template,
    fixedMonthlySalary: roundCurrency(override.fixedMonthlySalary ?? template.fixedMonthlySalary),
    baseSalary: roundCurrency(override.baseSalary ?? template.baseSalary),
    incentive: roundCurrency(override.incentive ?? template.incentive),
    bonus: roundCurrency(override.bonus ?? template.bonus),
    customAllowance: roundCurrency(override.customAllowance ?? template.customAllowance),
    hra: roundCurrency(override.hra ?? template.hra),
    studyAllowance: roundCurrency(override.studyAllowance ?? template.studyAllowance),
    deduction: roundCurrency(override.deduction ?? template.deduction),
    advanceDeduction: roundCurrency(override.advanceDeduction ?? template.advanceDeduction),
    pf: roundCurrency(override.pf ?? template.pf),
    tds: roundCurrency(override.tds ?? template.tds),
    professionalTax: roundCurrency(override.professionalTax ?? template.professionalTax),
    insurance: roundCurrency(override.insurance ?? template.insurance),
  };
}

function mapAttendanceSummary(summary: NonNullable<Awaited<ReturnType<typeof loadPayrollAttendanceSummary>>>): AttendanceRecord {
  return {
    employeeId: summary.employeeId,
    uid: summary.uid,
    month: summary.month,
    daysPresent: roundCurrency(summary.daysPresent ?? summary.presentDays),
    daysAbsent: roundCurrency(summary.daysAbsent ?? summary.absentDays),
    leavesApproved: roundCurrency(summary.leavesApproved ?? summary.leaveDays),
    totalWorkingDays: roundCurrency(summary.totalWorkingDays ?? summary.workingDays ?? DEFAULT_WORKING_DAYS),
    presentDays: roundCurrency(summary.daysPresent ?? summary.presentDays),
    absentDays: roundCurrency(summary.daysAbsent ?? summary.absentDays),
    leaveDays: roundCurrency(summary.leavesApproved ?? summary.leaveDays),
    halfDays: 0,
    overtimeHours: 0,
    workingDays: roundCurrency(summary.totalWorkingDays ?? summary.workingDays ?? DEFAULT_WORKING_DAYS),
    payableDays: roundCurrency(summary.payableDays ?? summary.daysPresent),
    lateCount: roundCurrency(summary.lateCount),
    attendanceTrackedDays: roundCurrency(summary.attendanceTrackedDays),
    explicitAbsentDays: roundCurrency(summary.explicitAbsentDays),
    totalWorkedMinutes: roundCurrency(summary.totalWorkedMinutes),
    totalSessions: roundCurrency(summary.totalSessions),
    attendanceCorrectionCount: roundCurrency(summary.attendanceCorrectionCount),
    attendanceCorrectionPendingCount: roundCurrency(summary.attendanceCorrectionPendingCount),
    attendanceCorrectionReasons: Array.isArray(summary.attendanceCorrectionReasons)
      ? summary.attendanceCorrectionReasons
      : [],
    attendanceCorrectionSummary: summary.attendanceCorrectionSummary ?? null,
    paidLeaveDays: roundCurrency(summary.paidLeaveDays),
    leaveAllowanceDays: roundCurrency(summary.leaveAllowanceDays),
    leaveExcessDays: roundCurrency(summary.leaveExcessDays),
    unpaidLeaveDays: roundCurrency(summary.unpaidLeaveDays),
    autoCalculatedAt: new Date().toISOString(),
  };
}

function applyAttendanceOverride(
  base: AttendanceRecord,
  override?: AttendanceOverrideInput | null,
): AttendanceRecord {
  if (!override) return base;

  const presentDays = roundCurrency(override.presentDays ?? base.presentDays);
  const leaveDays = roundCurrency(override.leaveDays ?? base.leaveDays);
  const halfDays = roundCurrency(override.halfDays ?? base.halfDays);
  const workingDays = Math.max(1, roundCurrency(override.workingDays ?? base.workingDays));
  const payableDays = roundCurrency(
    override.payableDays ?? presentDays + leaveDays + halfDays * 0.5,
  );
  const absentDays = roundCurrency(
    override.absentDays ?? Math.max(0, workingDays - payableDays),
  );

  return {
    ...base,
    daysPresent: presentDays,
    daysAbsent: absentDays,
    leavesApproved: leaveDays,
    totalWorkingDays: workingDays,
    presentDays,
    leaveDays,
    halfDays,
    overtimeHours: roundCurrency(override.overtimeHours ?? base.overtimeHours),
    workingDays,
    payableDays,
    absentDays,
    lateCount: roundCurrency(override.lateCount ?? base.lateCount),
  };
}

function buildSalaryBreakdown(
  attendance: AttendanceRecord,
  template: SalaryTemplate,
  override?: SalaryOverrideInput | null,
): PayrollSalaryBreakdown {
  const fixedMonthlySalary = roundCurrency(
    override?.fixedMonthlySalary ?? template.fixedMonthlySalary,
  );
  const baseSalary = roundCurrency(
    override?.baseSalary ?? template.baseSalary ?? fixedMonthlySalary,
  );
  const incentive = roundCurrency(override?.incentive ?? template.incentive);
  const bonus = roundCurrency(override?.bonus ?? template.bonus);
  const customAllowance = roundCurrency(
    override?.customAllowance ?? template.customAllowance,
  );
  const hra = roundCurrency(override?.hra ?? template.hra);
  const studyAllowance = roundCurrency(
    override?.studyAllowance ?? template.studyAllowance,
  );
  const deduction = roundCurrency(override?.deduction ?? template.deduction);
  const advanceDeduction = roundCurrency(
    override?.advanceDeduction ?? template.advanceDeduction,
  );
  const pf = roundCurrency(override?.pf ?? template.pf);
  const tds = roundCurrency(override?.tds ?? template.tds);
  const professionalTax = roundCurrency(
    override?.professionalTax ?? template.professionalTax,
  );
  const insurance = roundCurrency(override?.insurance ?? template.insurance);

  const perDaySalary = baseSalary / Math.max(1, attendance.workingDays);
  const lop = roundCurrency(perDaySalary * Math.max(0, attendance.absentDays));
  const hourlyRate = perDaySalary / 8;
  const overtimePay = roundCurrency(hourlyRate * Math.max(0, attendance.overtimeHours));
  const grossSalary = roundCurrency(
    baseSalary + incentive + bonus + customAllowance + hra + studyAllowance + overtimePay,
  );
  const totalDeductions = roundCurrency(
    lop + deduction + advanceDeduction + pf + tds + professionalTax + insurance,
  );
  const netPayOverride = override?.netPayOverride ?? null;
  const computedNet = Math.max(0, roundCurrency(grossSalary - totalDeductions));

  return {
    fixedMonthlySalary,
    baseSalary,
    incentive,
    bonus,
    customAllowance,
    hra,
    studyAllowance,
    overtimePay,
    attendanceAdjustment: -lop,
    grossSalary,
    deduction,
    advanceDeduction,
    pf,
    tds,
    professionalTax,
    insurance,
    totalDeductions,
    netPayOverride: netPayOverride == null ? null : roundCurrency(netPayOverride),
    netPay:
      netPayOverride == null
        ? computedNet
        : Math.max(0, roundCurrency(netPayOverride)),
  };
}

function normalizeDownloadHistory(value: unknown): PayrollDownloadEvent[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({
    at: toDate(row && typeof row === "object" ? (row as { at?: unknown }).at : null)?.toISOString() ?? null,
    byUid: String(row && typeof row === "object" ? (row as { byUid?: unknown }).byUid ?? "" : ""),
    byName: row && typeof row === "object" ? String((row as { byName?: unknown }).byName ?? "") || null : null,
    role: row && typeof row === "object" ? String((row as { role?: unknown }).role ?? "") || null : null,
    source:
      row && typeof row === "object" && (row as { source?: unknown }).source === "HR"
        ? "HR"
        : "EMPLOYEE",
  }));
}

function normalizeEmployeePayslipDownloadHistory(value: unknown): EmployeePayslipDownloadEvent[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({
    downloadedAt:
      toDate(row && typeof row === "object" ? (row as { downloadedAt?: unknown }).downloadedAt : null)?.toISOString() ??
      null,
    downloadedBy:
      row && typeof row === "object" && (row as { downloadedBy?: unknown }).downloadedBy
        ? {
            uid: String((((row as { downloadedBy?: { uid?: unknown } }).downloadedBy)?.uid ?? "")),
            name:
              String((((row as { downloadedBy?: { name?: unknown } }).downloadedBy)?.name ?? "")) || null,
            employeeId:
              String((((row as { downloadedBy?: { employeeId?: unknown } }).downloadedBy)?.employeeId ?? "")) || null,
            role:
              String((((row as { downloadedBy?: { role?: unknown } }).downloadedBy)?.role ?? "")) || null,
          }
        : null,
    ip: row && typeof row === "object" ? String((row as { ip?: unknown }).ip ?? "") || null : null,
    device:
      row && typeof row === "object" ? String((row as { device?: unknown }).device ?? "") || null : null,
  }));
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => typeof item !== "undefined") as T;
  }

  if (value instanceof Date) {
    return value;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => typeof entryValue !== "undefined")
      .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

function hydratePayrollRecord(snapshot: DocumentSnapshot | QueryDocumentSnapshot | null): PayrollRecord | null {
  if (!snapshot?.exists) return null;
  const data = snapshot.data() as PayrollRecord;

  return {
    ...data,
    id: snapshot.id,
    generatedAt: toDate(data.generatedAt) ?? new Date(),
    paidAt: toDate(data.paidAt) ?? undefined,
    sentAt: toDate(data.sentAt) ?? undefined,
    approvedAt: toDate(data.approvedAt) ?? undefined,
    downloadedAt: toDate(data.downloadedAt) ?? undefined,
    createdAt: toDate(data.createdAt) ?? null,
    updatedAt: toDate(data.updatedAt) ?? null,
    attendanceSummary: {
      ...data.attendanceSummary,
      autoCalculatedAt: data.attendanceSummary?.autoCalculatedAt ?? null,
    },
    downloadHistory: normalizeDownloadHistory(data.downloadHistory),
    downloadCount: roundCurrency(data.downloadCount),
    pdfUrl: data.pdfUrl ?? null,
    isVisibleToEmployee: Boolean(data.isVisibleToEmployee),
    notificationId: data.notificationId ?? null,
    version: Math.max(1, roundCurrency(data.version)),
    locked: data.locked !== false,
  };
}

function hydrateEmployeePayslipRecord(
  snapshot: DocumentSnapshot | QueryDocumentSnapshot | null,
): EmployeePayslipRecord | null {
  if (!snapshot?.exists) return null;
  const data = snapshot.data() as Partial<EmployeePayslipRecord>;

  return {
    id: snapshot.id,
    payrollRecordId: String(data.payrollRecordId ?? snapshot.id),
    employeeId: String(data.employeeId ?? ""),
    uid: String(data.uid ?? ""),
    month: String(data.month ?? ""),
    year: roundCurrency(data.year),
    monthName: String(data.monthName ?? data.month ?? ""),
    grossSalary: roundCurrency(data.grossSalary),
    deductions: roundCurrency(data.deductions),
    netSalary: roundCurrency(data.netSalary),
    pdfUrl: typeof data.pdfUrl === "string" ? data.pdfUrl : null,
    status: data.status === "downloaded" ? "downloaded" : "sent",
    sentAt: toDate(data.sentAt)?.toISOString() ?? null,
    sentBy: (data.sentBy as PayrollActor | null | undefined) ?? null,
    viewedAt: toDate(data.viewedAt)?.toISOString() ?? null,
    downloadCount: roundCurrency(data.downloadCount),
    downloadHistory: normalizeEmployeePayslipDownloadHistory(data.downloadHistory),
    notificationId: typeof data.notificationId === "string" ? data.notificationId : null,
    employee: (data.employee as PayrollEmployeeRecord | undefined) ?? {
      id: String(data.uid ?? ""),
      uid: String(data.uid ?? ""),
      name: "",
      email: null,
      employeeId: String(data.employeeId ?? ""),
      designation: null,
      department: null,
      salary: 0,
      joiningDate: null,
    },
    createdAt: toDate(data.createdAt) ?? null,
    updatedAt: toDate(data.updatedAt) ?? null,
  };
}

async function resolveEmployeeByKey(adminDb: Firestore, employeeKey: string) {
  const key = employeeKey.trim();
  if (!key) {
    throw new PayrollServiceError("Employee id is required.", 400);
  }

  const directSnap = await adminDb.collection("users").doc(key).get();
  if (directSnap.exists) {
    return { ...(directSnap.data() as UserDoc), uid: directSnap.id } satisfies UserDoc;
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
  return { ...(row.data() as UserDoc), uid: row.id } satisfies UserDoc;
}

async function readSalaryTemplate(
  adminDb: Firestore,
  user: UserDoc,
  month: string,
  actor?: PayrollActor | null,
) {
  const templateRef = adminDb.collection(SALARY_TEMPLATES).doc(user.uid);
  const templateSnap = await templateRef.get();
  if (templateSnap.exists) {
    const data = templateSnap.data() as SalaryTemplate;
    return {
      templateRef,
      template: {
        ...deriveSalaryTemplate(user, month, actor),
        ...data,
        employeeId: data.employeeId || user.employeeId?.trim() || user.uid,
        uid: user.uid,
      } satisfies SalaryTemplate,
    };
  }

  const template = deriveSalaryTemplate(user, month, actor);
  await templateRef.set({
    ...template,
    updatedAt: new Date(),
    updatedBy: actor ?? null,
  });

  return {
    templateRef,
    template,
  };
}

async function readAttendanceSummary(
  adminDb: Firestore,
  employee: PayrollEmployeeRecord,
  month: string,
  baseSalary: number,
  override?: AttendanceOverrideInput | null,
) {
  const summary = await loadPayrollAttendanceSummary(adminDb, {
    employeeId: employee.employeeId,
    uid: employee.uid,
    month,
    baseSalary,
  });

  if (!summary) return null;

  const autoCalculated = mapAttendanceSummary(summary);
  const finalSummary = applyAttendanceOverride(autoCalculated, override);
  const summaryRef = adminDb.collection(ATTENDANCE_SUMMARY).doc(buildPayrollDocId(employee.uid, month));

  await summaryRef.set(
    {
      id: summaryRef.id,
      employeeId: employee.employeeId,
      uid: employee.uid,
      month,
      employeeName: employee.name,
      autoCalculated,
      finalSummary,
      manualOverride: override ?? null,
      updatedAt: new Date(),
    },
    { merge: true },
  );

  return finalSummary;
}

async function findPayrollRecord(
  adminDb: Firestore,
  input: { employee: PayrollEmployeeRecord; month: string; payrollId?: string },
) {
  const requestedPayrollId = input.payrollId?.trim();
  if (requestedPayrollId) {
    const direct = await adminDb.collection(PAYROLL_RECORDS).doc(requestedPayrollId).get();
    if (direct.exists) return direct;
  }

  const canonicalId = buildPayrollDocId(input.employee.uid, input.month);
  const direct = await adminDb.collection(PAYROLL_RECORDS).doc(canonicalId).get();
  if (direct.exists) return direct;

  const fallback = await adminDb
    .collection(PAYROLL_RECORDS)
    .where("month", "==", input.month)
    .where("uid", "==", input.employee.uid)
    .limit(1)
    .get();

  return fallback.empty ? null : fallback.docs[0];
}

async function readEmployeePayslipRecord(
  adminDb: Firestore,
  payrollRecordId: string,
) {
  const direct = await adminDb.collection(EMPLOYEE_PAYSLIPS).doc(payrollRecordId).get();
  return hydrateEmployeePayslipRecord(direct);
}

function serializeEmployeePayslipRecord(record: EmployeePayslipRecord): EmployeePayslipListItem {
  return {
    id: record.id,
    payrollRecordId: record.payrollRecordId,
    employeeId: record.employeeId,
    uid: record.uid,
    month: record.month,
    year: record.year,
    monthName: record.monthName,
    grossSalary: record.grossSalary,
    deductions: record.deductions,
    netSalary: record.netSalary,
    pdfUrl: record.pdfUrl,
    status: record.status,
    sentAt: record.sentAt,
    sentBy: record.sentBy ?? null,
    viewedAt: record.viewedAt,
    downloadCount: record.downloadCount,
    downloadHistory: record.downloadHistory,
    notificationId: record.notificationId ?? null,
    employee: record.employee,
  };
}

function buildEmployeeNotificationPayload(input: {
  notificationId: string;
  payroll: PayrollRecord;
  actor: PayrollActor | null;
  payslipId: string;
  createdAt: Date;
}) {
  return {
    id: input.notificationId,
    recipientUid: input.payroll.uid,
    employeeId: input.payroll.employee.employeeId,
    title: "Payslip available",
    message: `Your ${getPayrollMonthParts(input.payroll.month).monthName} payslip is available for download.`,
    body: `Your ${getPayrollMonthParts(input.payroll.month).monthName} payslip is available for download.`,
    type: "PAYSLIP",
    month: input.payroll.month,
    referenceId: input.payslipId,
    payrollRecordId: input.payroll.id,
    payslipId: input.payslipId,
    isRead: false,
    read: false,
    createdAt: input.createdAt,
    sentBy: input.actor,
  };
}

function buildEmployeePayslipPayload(input: {
  payroll: PayrollRecord;
  existing?: EmployeePayslipRecord | null;
  actor: PayrollActor | null;
  sentAt: Date;
  notificationId: string | null;
  status?: EmployeePayslipRecord["status"];
}) {
  const monthParts = getPayrollMonthParts(input.payroll.month);
  const employeeId =
    input.payroll.employee.employeeId?.trim() ||
    input.payroll.employeeId?.trim() ||
    input.payroll.uid;
  const uid = input.payroll.uid?.trim() || input.payroll.employee.uid?.trim() || employeeId;
  return {
    id: input.payroll.id,
    payrollRecordId: input.payroll.id,
    employeeId,
    uid,
    month: input.payroll.month,
    year: monthParts.year,
    monthName: monthParts.monthName,
    grossSalary: roundCurrency(input.payroll.grossSalary ?? input.payroll.salaryBreakdown.grossSalary),
    deductions: roundCurrency(input.payroll.deductions ?? input.payroll.salaryBreakdown.totalDeductions),
    netSalary: roundCurrency(input.payroll.netPay ?? input.payroll.salaryBreakdown.netPay),
    pdfUrl:
      input.payroll.pdfUrl ??
      buildPdfUrl(input.payroll.employee.employeeId, input.payroll.month, input.payroll.id),
    status: input.status ?? input.existing?.status ?? "sent",
    sentAt: input.sentAt,
    sentBy: input.actor,
    viewedAt: input.existing?.viewedAt ?? null,
    downloadCount: input.existing?.downloadCount ?? 0,
    downloadHistory: input.existing?.downloadHistory ?? [],
    createdAt: input.existing?.createdAt ?? input.sentAt,
    updatedAt: input.sentAt,
    employee: {
      ...input.payroll.employee,
      employeeId,
      uid,
    },
    notificationId: input.notificationId,
  } satisfies Omit<EmployeePayslipRecord, "sentAt" | "viewedAt" | "createdAt" | "updatedAt"> & {
    sentAt: Date;
    viewedAt: string | null;
    createdAt: Date | string | null;
    updatedAt: Date;
  };
}

function buildPayrollVersionHistoryItem(input: {
  record: PayrollRecord;
  changedBy: PayrollActor | null;
  changeType: PayrollVersionHistoryItem["changeType"];
}) {
  return {
    id: `${input.record.id}_v${input.record.version}`,
    payrollRecordId: input.record.id,
    employeeId: input.record.employeeId || input.record.employee.employeeId,
    uid: input.record.uid,
    month: input.record.month,
    version: input.record.version,
    changedAt: new Date().toISOString(),
    changedBy: input.changedBy,
    changeType: input.changeType,
  } satisfies PayrollVersionHistoryItem;
}

async function writeVersionSnapshot(
  adminDb: Firestore,
  record: PayrollRecord,
  changedBy: PayrollActor | null,
  changeType: PayrollVersionHistoryItem["changeType"],
) {
  const metadata = buildPayrollVersionHistoryItem({ record, changedBy, changeType });
  await adminDb.collection(PAYROLL_VERSIONS).doc(metadata.id).set({
    ...metadata,
    changedAt: new Date(),
    snapshot: stripUndefinedDeep(record),
  });
}

async function syncLegacyPayrollDoc(adminDb: Firestore, record: PayrollRecord) {
  const payrollCycle = getDefaultPayrollCycle(record.month);
  const deductionItems = [
    { label: "LOP (Loss of Pay)", amount: Math.max(0, -record.salaryBreakdown.attendanceAdjustment) },
    { label: "Other Deduction", amount: record.salaryBreakdown.deduction },
    { label: "Advance Deduction", amount: record.salaryBreakdown.advanceDeduction },
    { label: "PF", amount: record.salaryBreakdown.pf },
    { label: "TDS", amount: record.salaryBreakdown.tds },
    { label: "Professional Tax", amount: record.salaryBreakdown.professionalTax },
    { label: "Health Insurance", amount: record.salaryBreakdown.insurance },
  ].filter((item) => item.amount > 0);

  const legacyDoc: Payroll = {
    id: record.id,
    uid: record.uid,
    month: record.month,
    employeeId: record.employee.employeeId,
    designation: record.employee.designation ?? undefined,
    department: record.employee.department ?? undefined,
    joiningDate: record.employee.joiningDate,
    basicSalary: record.salaryBreakdown.baseSalary,
    baseSalary: record.salaryBreakdown.baseSalary,
    daysPresent: record.attendanceSummary.presentDays,
    daysAbsent: record.attendanceSummary.absentDays,
    totalWorkingDays: record.attendanceSummary.workingDays,
    payableDays: record.attendanceSummary.payableDays,
    attendanceTrackedDays: record.attendanceSummary.attendanceTrackedDays,
    explicitAbsentDays: record.attendanceSummary.explicitAbsentDays,
    lates: record.attendanceSummary.lateCount,
    lateCount: record.attendanceSummary.lateCount,
    incentives: record.salaryBreakdown.incentive + record.salaryBreakdown.bonus,
    bonus: record.salaryBreakdown.bonus,
    bonuses: record.salaryBreakdown.bonus,
    deductions: record.salaryBreakdown.totalDeductions,
    leaveApprovedDays: record.attendanceSummary.leaveDays,
    paidLeaveDays: record.attendanceSummary.paidLeaveDays,
    leaveAllowanceDays: record.attendanceSummary.leaveAllowanceDays,
    leaveExcessDays: record.attendanceSummary.leaveExcessDays,
    unpaidLeaveDays: record.attendanceSummary.unpaidLeaveDays,
    totalWorkedMinutes: record.attendanceSummary.totalWorkedMinutes,
    totalSessions: record.attendanceSummary.totalSessions,
    attendanceCorrectionCount: record.attendanceSummary.attendanceCorrectionCount,
    attendanceCorrectionPendingCount: record.attendanceSummary.attendanceCorrectionPendingCount,
    attendanceCorrectionReasons: record.attendanceSummary.attendanceCorrectionReasons,
    attendanceCorrectionSummary: record.attendanceSummary.attendanceCorrectionSummary,
    grossSalary: record.salaryBreakdown.grossSalary,
    netPay: record.salaryBreakdown.netPay,
    netSalary: record.salaryBreakdown.netPay,
    paymentPeriodStart: payrollCycle?.start ?? null,
    paymentPeriodEnd: payrollCycle?.end ?? null,
    paymentDate: payrollCycle?.paymentDate ?? null,
    earnings: [
      { label: "Basic Salary", amount: record.salaryBreakdown.baseSalary },
      { label: "Incentive", amount: record.salaryBreakdown.incentive },
      { label: "Bonus", amount: record.salaryBreakdown.bonus },
      { label: "Custom Allowance", amount: record.salaryBreakdown.customAllowance },
      { label: "HRA", amount: record.salaryBreakdown.hra },
      { label: "Study Allowance", amount: record.salaryBreakdown.studyAllowance },
      { label: "Overtime", amount: record.salaryBreakdown.overtimePay },
    ].filter((item) => item.amount > 0),
    deductionItems,
    status: record.status,
    payslipUrl: record.pdfUrl ?? undefined,
    pdfUrl: record.pdfUrl ?? undefined,
    version: record.version,
    locked: record.locked,
    generatedBy: record.generatedBy,
    editedBy: record.editedBy,
    sentAt: record.sentAt ?? undefined,
    approvedAt: record.approvedAt ?? undefined,
    downloadedAt: record.downloadedAt ?? undefined,
    generatedAt: record.generatedAt,
    paidAt: record.paidAt,
    userDisplayName: record.employee.name,
    userEmail: record.employee.email ?? undefined,
  };

  await adminDb.collection(LEGACY_PAYROLL).doc(record.id).set(stripUndefinedDeep(legacyDoc), { merge: true });
}

function buildEphemeralPayrollRecord(input: {
  employee: PayrollEmployeeRecord;
  attendanceSummary: AttendanceRecord;
  salaryTemplate: SalaryTemplate;
  manualOverrides?: PayrollManualOverrides | null;
  month: string;
}) {
  const manualOverrides = input.manualOverrides ?? {};
  const effectiveTemplate = mergeSalaryTemplate(
    input.salaryTemplate,
    manualOverrides.salary ?? null,
  );
  const attendanceSummary = applyAttendanceOverride(
    input.attendanceSummary,
    manualOverrides.attendance ?? null,
  );
  const salaryBreakdown = buildSalaryBreakdown(
    attendanceSummary,
    effectiveTemplate,
    manualOverrides.salary ?? null,
  );
  const payrollId = buildPayrollDocId(input.employee.uid, input.month);
  const cycle = getDefaultPayrollCycle(input.month);

  return {
    id: payrollId,
    uid: input.employee.uid,
    employeeId: input.employee.employeeId,
    employee: input.employee,
    month: input.month,
    designation: input.employee.designation ?? undefined,
    department: input.employee.department ?? undefined,
    joiningDate: input.employee.joiningDate,
    basicSalary: salaryBreakdown.baseSalary,
    baseSalary: salaryBreakdown.baseSalary,
    daysPresent: attendanceSummary.presentDays,
    daysAbsent: attendanceSummary.absentDays,
    totalWorkingDays: attendanceSummary.workingDays,
    payableDays: attendanceSummary.payableDays,
    attendanceTrackedDays: attendanceSummary.attendanceTrackedDays,
    explicitAbsentDays: attendanceSummary.explicitAbsentDays,
    lates: attendanceSummary.lateCount,
    lateCount: attendanceSummary.lateCount,
    incentives: salaryBreakdown.incentive,
    bonus: salaryBreakdown.bonus,
    bonuses: salaryBreakdown.bonus,
    deductions: salaryBreakdown.totalDeductions,
    leaveApprovedDays: attendanceSummary.leaveDays,
    paidLeaveDays: attendanceSummary.paidLeaveDays,
    leaveAllowanceDays: attendanceSummary.leaveAllowanceDays,
    leaveExcessDays: attendanceSummary.leaveExcessDays,
    unpaidLeaveDays: attendanceSummary.unpaidLeaveDays,
    totalWorkedMinutes: attendanceSummary.totalWorkedMinutes,
    totalSessions: attendanceSummary.totalSessions,
    attendanceCorrectionCount: attendanceSummary.attendanceCorrectionCount,
    attendanceCorrectionPendingCount: attendanceSummary.attendanceCorrectionPendingCount,
    attendanceCorrectionReasons: attendanceSummary.attendanceCorrectionReasons,
    attendanceCorrectionSummary: attendanceSummary.attendanceCorrectionSummary,
    grossSalary: salaryBreakdown.grossSalary,
    netPay: salaryBreakdown.netPay,
    netSalary: salaryBreakdown.netPay,
    paymentPeriodStart: cycle?.start ?? null,
    paymentPeriodEnd: cycle?.end ?? null,
    paymentDate: cycle?.paymentDate ?? null,
    earnings: [
      { label: "Basic Salary", amount: salaryBreakdown.baseSalary },
      { label: "Incentive", amount: salaryBreakdown.incentive },
      { label: "Bonus", amount: salaryBreakdown.bonus },
      { label: "Custom Allowance", amount: salaryBreakdown.customAllowance },
      { label: "HRA", amount: salaryBreakdown.hra },
      { label: "Study Allowance", amount: salaryBreakdown.studyAllowance },
      { label: "Overtime", amount: salaryBreakdown.overtimePay },
    ].filter((item) => item.amount > 0),
    deductionItems: [
      { label: "LOP (Loss of Pay)", amount: Math.max(0, -salaryBreakdown.attendanceAdjustment) },
      { label: "Other Deduction", amount: salaryBreakdown.deduction },
      { label: "Advance Deduction", amount: salaryBreakdown.advanceDeduction },
      { label: "PF", amount: salaryBreakdown.pf },
      { label: "TDS", amount: salaryBreakdown.tds },
      { label: "Professional Tax", amount: salaryBreakdown.professionalTax },
      { label: "Health Insurance", amount: salaryBreakdown.insurance },
    ].filter((item) => item.amount > 0),
    status: "DRAFT",
    pdfUrl: buildPdfUrl(input.employee.employeeId, input.month, payrollId),
    payslipUrl: buildPdfUrl(input.employee.employeeId, input.month, payrollId),
    version: 1,
    locked: false,
    generatedAt: new Date(),
    generatedBy: null,
    editedBy: null,
    userDisplayName: input.employee.name,
    userEmail: input.employee.email ?? undefined,
    attendanceSummary,
    salaryTemplate: effectiveTemplate,
    salaryBreakdown,
    manualOverrides,
    downloadHistory: [],
    downloadCount: 0,
    sentAt: undefined,
    approvedAt: undefined,
    downloadedAt: undefined,
    createdAt: null,
    updatedAt: null,
    isVisibleToEmployee: false,
    notificationId: null,
  } satisfies PayrollRecord;
}

function normalizePayrollRecordWithContext(input: {
  payroll: PayrollRecord | null;
  employee: PayrollEmployeeRecord;
  attendanceSummary: AttendanceRecord;
  salaryTemplate: SalaryTemplate;
  month: string;
}) {
  const base = buildEphemeralPayrollRecord({
    employee: input.employee,
    attendanceSummary: input.attendanceSummary,
    salaryTemplate: input.salaryTemplate,
    manualOverrides: input.payroll?.manualOverrides ?? {},
    month: input.month,
  });

  if (!input.payroll) {
    return base;
  }

  const current = input.payroll;
  return {
    ...base,
    ...current,
    employee: current.employee ?? base.employee,
    attendanceSummary: {
      ...base.attendanceSummary,
      ...(current.attendanceSummary ?? {}),
    },
    salaryTemplate: {
      ...base.salaryTemplate,
      ...(current.salaryTemplate ?? {}),
    },
    salaryBreakdown: current.salaryBreakdown ?? base.salaryBreakdown,
    manualOverrides: current.manualOverrides ?? {},
    downloadHistory: current.downloadHistory ?? [],
    downloadCount: current.downloadCount ?? 0,
    isVisibleToEmployee: Boolean(current.isVisibleToEmployee),
    notificationId: current.notificationId ?? null,
    pdfUrl: current.pdfUrl ?? base.pdfUrl,
    payslipUrl: current.payslipUrl ?? base.payslipUrl,
    version: Math.max(1, roundCurrency(current.version ?? 1)),
    locked: current.locked ?? base.locked,
    netPay: roundCurrency(current.netPay ?? current.netSalary ?? base.netPay),
    netSalary: roundCurrency(current.netSalary ?? current.netPay ?? base.netSalary),
    grossSalary: roundCurrency(current.grossSalary ?? base.grossSalary),
    deductions: roundCurrency(current.deductions ?? base.deductions),
    generatedBy: current.generatedBy ?? null,
    editedBy: current.editedBy ?? null,
    approvedBy: current.approvedBy ?? null,
    sentBy: current.sentBy ?? null,
  } satisfies PayrollRecord;
}

async function buildPayrollContext(
  adminDb: Firestore,
  employeeKey: string,
  monthInput: string,
  options?: {
    payrollId?: string;
    manualOverrides?: PayrollManualOverrides | null;
    actor?: PayrollActor | null;
  },
) {
  const month = normalizeMonthKey(monthInput);
  const user = await resolveEmployeeByKey(adminDb, employeeKey);
  const employee = buildEmployeeRecord(user);
  const payrollSnap = await findPayrollRecord(adminDb, {
    employee,
    month,
    payrollId: options?.payrollId,
  });
  const payroll = hydratePayrollRecord(payrollSnap);
  const { templateRef, template } = await readSalaryTemplate(adminDb, user, month, options?.actor);
  const manualOverrides = options?.manualOverrides ?? payroll?.manualOverrides ?? {};
  const attendanceSummary = await readAttendanceSummary(
    adminDb,
    employee,
    month,
    template.baseSalary || employee.salary,
    manualOverrides.attendance ?? null,
  );

  return {
    month,
    user,
    employee,
    payroll,
    templateRef,
    salaryTemplate: template,
    attendanceSummary,
  };
}

function buildFallbackAttendanceRecord(employee: PayrollEmployeeRecord, month: string): AttendanceRecord {
  return {
    employeeId: employee.employeeId,
    uid: employee.uid,
    month,
    presentDays: 0,
    absentDays: DEFAULT_WORKING_DAYS,
    daysPresent: 0,
    daysAbsent: DEFAULT_WORKING_DAYS,
    leavesApproved: 0,
    totalWorkingDays: DEFAULT_WORKING_DAYS,
    leaveDays: 0,
    halfDays: 0,
    overtimeHours: 0,
    workingDays: DEFAULT_WORKING_DAYS,
    payableDays: 0,
    lateCount: 0,
    attendanceTrackedDays: 0,
    explicitAbsentDays: 0,
    totalWorkedMinutes: 0,
    totalSessions: 0,
    attendanceCorrectionCount: 0,
    attendanceCorrectionPendingCount: 0,
    attendanceCorrectionReasons: [],
    attendanceCorrectionSummary: null,
    paidLeaveDays: 0,
    leaveAllowanceDays: 0,
    leaveExcessDays: 0,
    unpaidLeaveDays: 0,
    autoCalculatedAt: null,
  } satisfies AttendanceRecord;
}

function mergeManualOverrides(
  current: PayrollManualOverrides | null | undefined,
  input: PayrollManualOverrides | null | undefined,
) {
  return {
    attendance: {
      ...(current?.attendance ?? {}),
      ...(input?.attendance ?? {}),
    },
    salary: {
      ...(current?.salary ?? {}),
      ...(input?.salary ?? {}),
    },
  } satisfies PayrollManualOverrides;
}

function clearDeliveryOnEdit(status: PayrollRecord["status"]) {
  return status === "APPROVED" || status === "SENT" || status === "DOWNLOADED";
}

function ensurePayrollEditable(record: PayrollRecord | null) {
  if (!record) return;
  if (record.status === "DOWNLOADED" || record.status === "SENT" || record.status === "APPROVED" || record.status === "GENERATED" || record.status === "DRAFT") {
    return;
  }
  throw new PayrollServiceError("Payroll record cannot be edited.", 409);
}

export async function savePayrollRecord(
  adminDb: Firestore,
  input: SavePayrollRequest,
  actor: Pick<UserDoc, "uid" | "displayName" | "email" | "employeeId" | "role" | "orgRole">,
) {
  const actorInfo = buildActor(actor);
  const context = await buildPayrollContext(adminDb, input.employeeId, input.month, {
    manualOverrides: {
      attendance: input.attendanceOverride ?? null,
      salary: input.salaryOverride ?? null,
    },
    actor: actorInfo,
  });

  if (!isActivePayrollUser(context.user)) {
    throw new PayrollServiceError("Employee is not active for payroll.", 409);
  }

  ensurePayrollEditable(context.payroll);

  const manualOverrides = mergeManualOverrides(context.payroll?.manualOverrides, {
    attendance: input.attendanceOverride ?? null,
    salary: input.salaryOverride ?? null,
  });

  let nextTemplate = context.salaryTemplate;
  if (input.saveAsTemplate) {
    nextTemplate = mergeSalaryTemplate(context.salaryTemplate, manualOverrides.salary ?? null);
    await context.templateRef.set(
      stripUndefinedDeep({
        ...nextTemplate,
        updatedAt: new Date(),
        updatedBy: actorInfo,
      }),
      { merge: true },
    );
  }

  const attendanceSummary =
    context.attendanceSummary ?? buildFallbackAttendanceRecord(context.employee, context.month);

  const baseRecord = buildEphemeralPayrollRecord({
    employee: context.employee,
    attendanceSummary,
    salaryTemplate: nextTemplate,
    manualOverrides,
    month: context.month,
  });

  const now = new Date();
  const existing = context.payroll;
  const shouldFinalize = Boolean(input.finalizeGeneration);
  const nextStatus: PayrollRecord["status"] = shouldFinalize
    ? "GENERATED"
    : existing
      ? clearDeliveryOnEdit(existing.status)
        ? "GENERATED"
        : existing.status
      : "DRAFT";

  if (shouldFinalize && existing && existing.status !== "DRAFT") {
    throw new PayrollServiceError("Payroll already generated for this employee and month.", 409);
  }

  if (baseRecord.salaryBreakdown.baseSalary <= 0) {
    throw new PayrollServiceError(
      "Base salary is zero. Update the salary template or override before saving payroll.",
      422,
    );
  }

  const nextRecord: PayrollRecord = {
    ...baseRecord,
    status: nextStatus,
    version: existing ? existing.version + 1 : 1,
    locked: shouldFinalize || nextStatus !== "DRAFT",
    generatedAt:
      shouldFinalize || existing?.generatedAt
        ? existing?.generatedAt ?? now
        : now,
    generatedBy: shouldFinalize ? actorInfo : existing?.generatedBy ?? null,
    editedBy: existing ? actorInfo : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    sentAt: clearDeliveryOnEdit(existing?.status ?? "DRAFT") ? undefined : existing?.sentAt,
    approvedAt: clearDeliveryOnEdit(existing?.status ?? "DRAFT") ? undefined : existing?.approvedAt,
    downloadedAt: clearDeliveryOnEdit(existing?.status ?? "DRAFT") ? undefined : existing?.downloadedAt,
    approvedBy: clearDeliveryOnEdit(existing?.status ?? "DRAFT") ? null : existing?.approvedBy ?? null,
    sentBy: clearDeliveryOnEdit(existing?.status ?? "DRAFT") ? null : existing?.sentBy ?? null,
    isVisibleToEmployee: clearDeliveryOnEdit(existing?.status ?? "DRAFT")
      ? false
      : existing?.isVisibleToEmployee ?? false,
    notificationId: clearDeliveryOnEdit(existing?.status ?? "DRAFT")
      ? null
      : existing?.notificationId ?? null,
    downloadHistory: clearDeliveryOnEdit(existing?.status ?? "DRAFT")
      ? []
      : existing?.downloadHistory ?? [],
    downloadCount: clearDeliveryOnEdit(existing?.status ?? "DRAFT")
      ? 0
      : existing?.downloadCount ?? 0,
  };

  if (existing) {
    await writeVersionSnapshot(
      adminDb,
      existing,
      actorInfo,
      shouldFinalize ? "GENERATED" : "EDITED",
    );
  }

  const recordRef = adminDb.collection(PAYROLL_RECORDS).doc(nextRecord.id);
  await recordRef.set(stripUndefinedDeep(nextRecord), { merge: true });
  await syncLegacyPayrollDoc(adminDb, nextRecord);
  await writeVersionSnapshot(
    adminDb,
    nextRecord,
    actorInfo,
    existing ? (shouldFinalize ? "GENERATED" : "EDITED") : "CREATED",
  );

  return getPayrollDetails(adminDb, input.employeeId, input.month, {
    payrollId: nextRecord.id,
  });
}

export async function generatePayrollRecord(
  adminDb: Firestore,
  input: GeneratePayrollRequest,
  actor: Pick<UserDoc, "uid" | "displayName" | "email" | "employeeId" | "role" | "orgRole">,
) {
  return savePayrollRecord(
    adminDb,
    {
      employeeId: input.employeeId,
      month: input.month,
      finalizeGeneration: true,
    },
    actor,
  );
}

export async function generatePayrollBatch(
  adminDb: Firestore,
  monthInput: string,
  actor: Pick<UserDoc, "uid" | "displayName" | "email" | "employeeId" | "role" | "orgRole">,
): Promise<BulkGeneratePayrollResponse> {
  const month = normalizeMonthKey(monthInput);
  const usersSnap = await adminDb.collection("users").where("status", "==", "active").get();
  const activeEmployees = usersSnap.docs
    .map((row) => ({ ...(row.data() as UserDoc), uid: row.id }))
    .filter(isActivePayrollUser);

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
    try {
      const details = await generatePayrollRecord(
        adminDb,
        { employeeId: employee.employeeId?.trim() || employee.uid, month },
        actor,
      );
      summary.generated += 1;
      results.push({
        employeeId: details.employee.employeeId,
        uid: details.employee.uid,
        name: details.employee.name,
        status: "GENERATED",
        message: "Payroll generated successfully.",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to generate payroll.";
      if (message.toLowerCase().includes("already generated")) {
        summary.alreadyGenerated += 1;
        results.push({
          employeeId: employee.employeeId?.trim() || employee.uid,
          uid: employee.uid,
          name: getDisplayName(employee),
          status: "ALREADY_GENERATED",
          message,
        });
        continue;
      }
      if (message.toLowerCase().includes("attendance")) {
        summary.missingAttendance += 1;
        results.push({
          employeeId: employee.employeeId?.trim() || employee.uid,
          uid: employee.uid,
          name: getDisplayName(employee),
          status: "MISSING_ATTENDANCE",
          message,
        });
        continue;
      }
      if (message.toLowerCase().includes("salary")) {
        summary.zeroSalary += 1;
        results.push({
          employeeId: employee.employeeId?.trim() || employee.uid,
          uid: employee.uid,
          name: getDisplayName(employee),
          status: "ZERO_SALARY",
          message,
        });
        continue;
      }

      summary.failed += 1;
      results.push({
        employeeId: employee.employeeId?.trim() || employee.uid,
        uid: employee.uid,
        name: getDisplayName(employee),
        status: "FAILED",
        message,
      });
    }
  }

  return { month, summary, results };
}

async function listVersionHistory(adminDb: Firestore, payrollRecordId: string) {
  const snap = await adminDb
    .collection(PAYROLL_VERSIONS)
    .where("payrollRecordId", "==", payrollRecordId)
    .get();

  return snap.docs
    .map((row) => {
      const data = row.data() as PayrollVersionHistoryItem;
      return {
        ...data,
        id: row.id,
        changedAt: toDate(data.changedAt)?.toISOString() ?? null,
      } satisfies PayrollVersionHistoryItem;
    })
    .sort((left, right) => right.version - left.version);
}

export async function getPayrollDetails(
  adminDb: Firestore,
  employeeKey: string,
  monthInput: string,
  options?: { payrollId?: string },
): Promise<PayrollDetailsResponse> {
  const context = await buildPayrollContext(adminDb, employeeKey, monthInput, {
    payrollId: options?.payrollId,
  });
  const existingManualOverrides = context.payroll ? context.payroll.manualOverrides : {};
  const fallbackAttendance =
    context.attendanceSummary ?? buildFallbackAttendanceRecord(context.employee, context.month);

  const payroll = normalizePayrollRecordWithContext({
    payroll: context.payroll
      ? {
          ...context.payroll,
          manualOverrides: existingManualOverrides,
        }
      : null,
    employee: context.employee,
    attendanceSummary: fallbackAttendance,
    salaryTemplate: context.salaryTemplate,
    month: context.month,
  });

  return {
    employee: context.employee,
    attendanceSummary: payroll.attendanceSummary,
    salaryTemplate: payroll.salaryTemplate,
    payroll,
    exists: Boolean(context.payroll),
    versionHistory: context.payroll ? await listVersionHistory(adminDb, context.payroll.id) : [],
  };
}

export async function listPayrollForMonth(
  adminDb: Firestore,
  monthInput: string,
): Promise<PayrollListResponse> {
  const month = normalizeMonthKey(monthInput);
  const [usersSnap, payrollSnap] = await Promise.all([
    adminDb.collection("users").where("status", "==", "active").get(),
    adminDb.collection(PAYROLL_RECORDS).where("month", "==", month).get(),
  ]);

  const users = usersSnap.docs
    .map((row) => ({ ...(row.data() as UserDoc), uid: row.id }))
    .filter(isActivePayrollUser);
  const payrollByUid = new Map(
    payrollSnap.docs.map((row) => {
      const hydrated = hydratePayrollRecord(row);
      return [String(hydrated?.uid ?? ""), hydrated] as const;
    }),
  );

  const items: PayrollListItem[] = [];
  for (const user of users.sort((left, right) => getDisplayName(left).localeCompare(getDisplayName(right)))) {
    const employee = buildEmployeeRecord(user);
    const rawPayroll = payrollByUid.get(employee.uid) ?? null;
    const template = deriveSalaryTemplate(user, month);

    if (rawPayroll) {
      const attendanceSummary =
        rawPayroll.attendanceSummary ??
        ({
          employeeId: employee.employeeId,
          uid: employee.uid,
          month,
          presentDays: roundCurrency(rawPayroll.daysPresent ?? 0),
          absentDays: roundCurrency(rawPayroll.daysAbsent ?? 0),
          daysPresent: roundCurrency(rawPayroll.daysPresent ?? 0),
          daysAbsent: roundCurrency(rawPayroll.daysAbsent ?? 0),
          leavesApproved: roundCurrency(rawPayroll.leaveApprovedDays ?? 0),
          totalWorkingDays: roundCurrency(rawPayroll.totalWorkingDays ?? DEFAULT_WORKING_DAYS),
          leaveDays: roundCurrency(rawPayroll.leaveApprovedDays ?? 0),
          halfDays: 0,
          overtimeHours: 0,
          workingDays: roundCurrency(rawPayroll.totalWorkingDays ?? DEFAULT_WORKING_DAYS),
          payableDays: roundCurrency(rawPayroll.payableDays ?? rawPayroll.daysPresent ?? 0),
          lateCount: roundCurrency(rawPayroll.lateCount ?? rawPayroll.lates ?? 0),
          attendanceTrackedDays: roundCurrency(rawPayroll.attendanceTrackedDays ?? 0),
          explicitAbsentDays: roundCurrency(rawPayroll.explicitAbsentDays ?? 0),
          totalWorkedMinutes: roundCurrency(rawPayroll.totalWorkedMinutes ?? 0),
          totalSessions: roundCurrency(rawPayroll.totalSessions ?? 0),
          attendanceCorrectionCount: roundCurrency(rawPayroll.attendanceCorrectionCount ?? 0),
          attendanceCorrectionPendingCount: roundCurrency(rawPayroll.attendanceCorrectionPendingCount ?? 0),
          attendanceCorrectionReasons: rawPayroll.attendanceCorrectionReasons ?? [],
          attendanceCorrectionSummary: rawPayroll.attendanceCorrectionSummary ?? null,
          paidLeaveDays: roundCurrency(rawPayroll.paidLeaveDays ?? 0),
          leaveAllowanceDays: roundCurrency(rawPayroll.leaveAllowanceDays ?? 0),
          leaveExcessDays: roundCurrency(rawPayroll.leaveExcessDays ?? 0),
          unpaidLeaveDays: roundCurrency(rawPayroll.unpaidLeaveDays ?? 0),
          autoCalculatedAt: null,
        } satisfies AttendanceRecord);
      const payroll = normalizePayrollRecordWithContext({
        payroll: rawPayroll,
        employee,
        attendanceSummary,
        salaryTemplate: rawPayroll.salaryTemplate ?? template,
        month,
      });

      items.push({
        employee,
        payroll,
        attendanceSummary: payroll.attendanceSummary,
        salaryTemplate: payroll.salaryTemplate,
        status: payroll.status,
        issue: null,
      });
      continue;
    }

    if (template.baseSalary <= 0) {
      items.push({
        employee,
        payroll: null,
        attendanceSummary: null,
        salaryTemplate: template,
        status: "ZERO_SALARY",
        issue: "Salary template is missing or base salary is zero.",
      });
      continue;
    }

    const attendance = await readAttendanceSummary(
      adminDb,
      employee,
      month,
      template.baseSalary,
      null,
    );

    if (!attendance) {
      items.push({
        employee,
        payroll: null,
        attendanceSummary: null,
        salaryTemplate: template,
        status: "MISSING_ATTENDANCE",
        issue: "Attendance is missing for this month.",
      });
      continue;
    }

    items.push({
      employee,
      payroll: null,
      attendanceSummary: attendance,
      salaryTemplate: template,
      status: "NOT_GENERATED",
      issue: null,
    });
  }

  return {
    month,
    summary: {
      totalEmployees: items.length,
      totalPayout: items.reduce((sum, item) => sum + Number(item.payroll?.netPay ?? 0), 0),
      payrollRecords: items.filter((item) => item.payroll).length,
      drafts: items.filter((item) => item.status === "DRAFT").length,
      sent: items.filter((item) => item.status === "SENT" || item.status === "DOWNLOADED").length,
    },
    items,
  };
}

export async function approvePayrollRecord(
  adminDb: Firestore,
  employeeKey: string,
  monthInput: string,
  actor: Pick<UserDoc, "uid" | "displayName" | "email" | "employeeId" | "role" | "orgRole">,
) {
  const details = await getPayrollDetails(adminDb, employeeKey, monthInput);
  if (!details.exists) {
    throw new PayrollServiceError("Generate payroll before approving it.", 409);
  }
  if (details.payroll.status === "DRAFT") {
    throw new PayrollServiceError("Generate payroll before approving it.", 409);
  }

  const actorInfo = buildActor(actor);
  const current = details.payroll;
  await writeVersionSnapshot(adminDb, current, actorInfo, "APPROVED");

  const updated: PayrollRecord = {
    ...current,
    status: "APPROVED",
    version: current.version + 1,
    approvedAt: new Date(),
    approvedBy: actorInfo,
    editedBy: actorInfo,
    updatedAt: new Date(),
  };

  await adminDb.collection(PAYROLL_RECORDS).doc(current.id).set(stripUndefinedDeep(updated), { merge: true });
  await syncLegacyPayrollDoc(adminDb, updated);
  return getPayrollDetails(adminDb, employeeKey, monthInput, { payrollId: current.id });
}

export async function sendPayrollToEmployee(
  adminDb: Firestore,
  employeeKey: string,
  monthInput: string,
  actor: Pick<UserDoc, "uid" | "displayName" | "email" | "employeeId" | "role" | "orgRole">,
  options?: { resend?: boolean; payrollId?: string },
) {
  const details = await getPayrollDetails(adminDb, employeeKey, monthInput, {
    payrollId: options?.payrollId,
  });
  if (!details.exists) {
    throw new PayrollServiceError("Generate payroll before sending it.", 409);
  }
  if (details.payroll.status === "DRAFT") {
    throw new PayrollServiceError("Generate payroll before sending it.", 409);
  }

  const resend = options?.resend === true;
  const actorInfo = buildActor(actor);
  const current = details.payroll;
  const existingPayslip = await readEmployeePayslipRecord(adminDb, current.id);
  const alreadySent = Boolean(existingPayslip) || current.status === "SENT" || current.status === "DOWNLOADED";

  if (!resend && alreadySent) {
    throw new PayrollServiceError("Already Sent", 409);
  }

  if (
    current.status !== "GENERATED" &&
    current.status !== "APPROVED" &&
    current.status !== "SENT" &&
    current.status !== "DOWNLOADED"
  ) {
    throw new PayrollServiceError("Payroll must be generated or approved before sending.", 409);
  }

  const now = new Date();

  const notificationRef = adminDb.collection(EMPLOYEE_NOTIFICATIONS).doc();
  const notificationPayload = buildEmployeeNotificationPayload({
    notificationId: notificationRef.id,
    payroll: current,
    actor: actorInfo,
    payslipId: current.id,
    createdAt: now,
  });
  const nextPayslipStatus: EmployeePayslipRecord["status"] =
    existingPayslip?.status === "downloaded" || current.status === "DOWNLOADED"
      ? "downloaded"
      : "sent";
  const payslipPayload = buildEmployeePayslipPayload({
    payroll: current,
    existing: existingPayslip,
    actor: actorInfo,
    sentAt: now,
    notificationId: notificationRef.id,
    status: nextPayslipStatus,
  });

  await Promise.all([
    notificationRef.set(stripUndefinedDeep(notificationPayload)),
    adminDb.collection("notifications").doc(notificationRef.id).set(stripUndefinedDeep(notificationPayload)),
    adminDb.collection(EMPLOYEE_PAYSLIPS).doc(current.id).set(stripUndefinedDeep(payslipPayload), { merge: true }),
  ]);

  if (current.status === "GENERATED" || current.status === "APPROVED" || !alreadySent) {
    await writeVersionSnapshot(adminDb, current, actorInfo, "SENT");

    const updated: PayrollRecord = {
      ...current,
      status: "SENT",
      version: current.version + 1,
      sentAt: now,
      sentBy: actorInfo,
      editedBy: actorInfo,
      updatedAt: now,
      isVisibleToEmployee: true,
      notificationId: notificationRef.id,
    };

    await adminDb.collection(PAYROLL_RECORDS).doc(current.id).set(stripUndefinedDeep(updated), { merge: true });
    await syncLegacyPayrollDoc(adminDb, updated);
    return getPayrollDetails(adminDb, employeeKey, monthInput, { payrollId: current.id });
  }

  await adminDb.collection(PAYROLL_RECORDS).doc(current.id).set(
    stripUndefinedDeep({
      isVisibleToEmployee: true,
      notificationId: notificationRef.id,
      updatedAt: now,
    }),
    { merge: true },
  );
  return getPayrollDetails(adminDb, employeeKey, monthInput, { payrollId: current.id });
}

export async function resendPayrollToEmployee(
  adminDb: Firestore,
  input: SendPayslipRequest,
  actor: Pick<UserDoc, "uid" | "displayName" | "email" | "employeeId" | "role" | "orgRole">,
) {
  return sendPayrollToEmployee(adminDb, input.employeeId, input.month, actor, {
    resend: true,
    payrollId: input.payrollRecordId ?? undefined,
  });
}

export async function listEmployeePayslips(
  adminDb: Firestore,
  requester: Pick<UserDoc, "uid" | "employeeId">,
): Promise<EmployeePayslipListResponse> {
  const identityKeys = Array.from(
    new Set([requester.uid?.trim(), requester.employeeId?.trim()].filter(Boolean) as string[]),
  );

  const payslipSnapshots = await Promise.all(
    identityKeys.map((key) =>
      adminDb
        .collection(EMPLOYEE_PAYSLIPS)
        .where(key === requester.uid?.trim() ? "uid" : "employeeId", "==", key)
        .get(),
    ),
  );

  const rowsById = new Map<string, EmployeePayslipRecord>();
  for (const snapshot of payslipSnapshots) {
    for (const row of snapshot.docs) {
      const hydrated = hydrateEmployeePayslipRecord(row);
      if (!hydrated || !matchesEmployeeIdentity(hydrated, requester)) {
        continue;
      }

      rowsById.set(hydrated.id, hydrated);
    }
  }

  let rows = Array.from(rowsById.values());

  if (rows.length === 0) {
    const payrollSnapshots = await Promise.all(
      identityKeys.map((key) =>
        adminDb
          .collection(PAYROLL_RECORDS)
          .where(key === requester.uid?.trim() ? "uid" : "employeeId", "==", key)
          .get(),
      ),
    );
    const visiblePayrolls = payrollSnapshots
      .flatMap((snapshot) => snapshot.docs)
      .map((row) => hydratePayrollRecord(row))
      .filter((row): row is PayrollRecord => Boolean(row))
      .filter((row) => matchesEmployeeIdentity(row, requester))
      .filter((row) => row.isVisibleToEmployee && (row.status === "SENT" || row.status === "DOWNLOADED"));

    for (const payroll of visiblePayrolls) {
      const payload = buildEmployeePayslipPayload({
        payroll,
        existing: null,
        actor: payroll.sentBy ?? payroll.generatedBy ?? null,
        sentAt: payroll.sentAt ?? toDate(payroll.generatedAt) ?? new Date(),
        notificationId: payroll.notificationId ?? null,
        status: payroll.status === "DOWNLOADED" ? "downloaded" : "sent",
      });
      await adminDb.collection(EMPLOYEE_PAYSLIPS).doc(payroll.id).set(stripUndefinedDeep(payload), { merge: true });
      const created = await readEmployeePayslipRecord(adminDb, payroll.id);
      if (created && matchesEmployeeIdentity(created, requester)) {
        rowsById.set(created.id, created);
      }
    }
  }

  rows = Array.from(rowsById.values());

  const items = rows
    .sort((left, right) => right.month.localeCompare(left.month))
    .map(serializeEmployeePayslipRecord);

  return { items };
}

export async function getEmployeePayslipDetails(
  adminDb: Firestore,
  payslipId: string,
  requester: Pick<UserDoc, "uid" | "employeeId">,
): Promise<EmployeePayslipDetailsResponse> {
  const payslipSnap = await adminDb.collection(EMPLOYEE_PAYSLIPS).doc(payslipId).get();
  const payslip = hydrateEmployeePayslipRecord(payslipSnap);
  if (!payslip) {
    throw new PayrollServiceError("Payslip not found.", 404);
  }
  if (payslip.uid !== requester.uid && payslip.employeeId !== requester.employeeId) {
    throw new PayrollServiceError("Forbidden", 403);
  }

  const details = await getPayrollDetails(adminDb, payslip.employeeId, payslip.month, {
    payrollId: payslip.payrollRecordId,
  });

  await adminDb.collection(EMPLOYEE_PAYSLIPS).doc(payslip.id).set(
    stripUndefinedDeep({
      viewedAt: new Date(),
      updatedAt: new Date(),
    }),
    { merge: true },
  );

  return {
    payslip: {
      ...serializeEmployeePayslipRecord(payslip),
      viewedAt: new Date().toISOString(),
    },
    payroll: details.payroll,
  };
}

export async function recordPayrollDownload(
  adminDb: Firestore,
  employeeKey: string,
  monthInput: string,
  actor: Pick<UserDoc, "uid" | "displayName" | "email" | "employeeId" | "role" | "orgRole">,
  source: "HR" | "EMPLOYEE",
  options?: { payrollId?: string },
) {
  const details = await getPayrollDetails(adminDb, employeeKey, monthInput, options);
  if (!details.exists) {
    throw new PayrollServiceError("Payroll record not found.", 404);
  }

  const current = details.payroll;
  if (source === "EMPLOYEE" && !current.isVisibleToEmployee) {
    throw new PayrollServiceError("Payslip is not available yet.", 403);
  }

  const actorInfo = buildActor(actor);
  const downloadEvent: PayrollDownloadEvent = {
    at: new Date().toISOString(),
    byUid: actorInfo.uid,
    byName: actorInfo.name,
    role: actorInfo.role,
    source,
  };

  const nextStatus =
    source === "EMPLOYEE" && current.status === "SENT" ? "DOWNLOADED" : current.status;
  const updated: PayrollRecord = {
    ...current,
    status: nextStatus,
    downloadedAt: source === "EMPLOYEE" ? new Date() : current.downloadedAt,
    updatedAt: new Date(),
    downloadHistory: [...current.downloadHistory, downloadEvent],
    downloadCount: current.downloadCount + 1,
  };

  await adminDb.collection(PAYROLL_RECORDS).doc(current.id).set(stripUndefinedDeep(updated), { merge: true });
  await syncLegacyPayrollDoc(adminDb, updated);
  return updated;
}

export async function recordEmployeePayslipDownload(
  adminDb: Firestore,
  payslipId: string,
  actor: Pick<UserDoc, "uid" | "displayName" | "email" | "employeeId" | "role" | "orgRole">,
  metadata: { ip?: string | null; device?: string | null },
) {
  const payslipSnap = await adminDb.collection(EMPLOYEE_PAYSLIPS).doc(payslipId).get();
  const payslip = hydrateEmployeePayslipRecord(payslipSnap);
  if (!payslip) {
    throw new PayrollServiceError("Payslip not found.", 404);
  }

  if (payslip.uid !== actor.uid && payslip.employeeId !== actor.employeeId) {
    throw new PayrollServiceError("Forbidden", 403);
  }

  const actorInfo = buildActor(actor);
  const event: EmployeePayslipDownloadEvent = {
    downloadedAt: new Date().toISOString(),
    downloadedBy: actorInfo,
    ip: metadata.ip?.trim() || null,
    device: metadata.device?.trim() || null,
  };

  const nextStatus: EmployeePayslipRecord["status"] = "downloaded";
  await adminDb.collection(EMPLOYEE_PAYSLIPS).doc(payslip.id).set(
    stripUndefinedDeep({
      status: nextStatus,
      viewedAt: payslip.viewedAt ? new Date(payslip.viewedAt) : new Date(),
      downloadCount: payslip.downloadCount + 1,
      downloadHistory: [...payslip.downloadHistory, event],
      updatedAt: new Date(),
    }),
    { merge: true },
  );

  await recordPayrollDownload(
    adminDb,
    payslip.employeeId,
    payslip.month,
    actor,
    "EMPLOYEE",
    { payrollId: payslip.payrollRecordId },
  );

  return {
    payslip: {
      ...payslip,
      status: nextStatus,
      viewedAt: payslip.viewedAt ?? new Date().toISOString(),
      downloadCount: payslip.downloadCount + 1,
      downloadHistory: [...payslip.downloadHistory, event],
    },
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

function matchesEmployeeIdentity(
  record: Pick<EmployeePayslipRecord | PayrollRecord, "uid" | "employeeId">,
  requester: Pick<UserDoc, "uid" | "employeeId">,
) {
  const requesterUid = requester.uid?.trim();
  const requesterEmployeeId = requester.employeeId?.trim();
  const recordUid = record.uid?.trim();
  const recordEmployeeId = record.employeeId?.trim();

  return Boolean(
    (requesterUid && recordUid && requesterUid === recordUid) ||
      (requesterEmployeeId && recordEmployeeId && requesterEmployeeId === recordEmployeeId),
  );
}
