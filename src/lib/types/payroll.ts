import type { Payroll } from "@/lib/types/hr";

export type PayrollWorkflowStatus =
  | "DRAFT"
  | "GENERATED"
  | "APPROVED"
  | "SENT"
  | "DOWNLOADED";

export type PayrollRecordStatus =
  | PayrollWorkflowStatus
  | "NOT_GENERATED"
  | "ZERO_SALARY"
  | "MISSING_ATTENDANCE";

export type PayrollActor = {
  uid: string;
  name: string | null;
  employeeId: string | null;
  role: string | null;
};

export type PayrollEmployeeRecord = {
  id: string;
  uid: string;
  name: string;
  email: string | null;
  employeeId: string;
  designation: string | null;
  department: string | null;
  salary: number;
  joiningDate: string | null;
};

export type AttendanceRecord = {
  employeeId: string;
  uid: string;
  month: string;
  daysPresent?: number;
  daysAbsent?: number;
  leavesApproved?: number;
  totalWorkingDays?: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  halfDays: number;
  overtimeHours: number;
  workingDays: number;
  payableDays: number;
  lateCount: number;
  attendanceTrackedDays: number;
  explicitAbsentDays: number;
  totalWorkedMinutes: number;
  totalSessions: number;
  attendanceCorrectionCount: number;
  attendanceCorrectionPendingCount: number;
  attendanceCorrectionReasons: string[];
  attendanceCorrectionSummary: string | null;
  paidLeaveDays: number;
  leaveAllowanceDays: number;
  leaveExcessDays: number;
  unpaidLeaveDays: number;
  autoCalculatedAt?: string | null;
};

export type AttendanceOverrideInput = Partial<
  Pick<
    AttendanceRecord,
    | "presentDays"
    | "absentDays"
    | "leaveDays"
    | "halfDays"
    | "overtimeHours"
    | "workingDays"
    | "payableDays"
    | "lateCount"
  >
> & {
  reason?: string | null;
};

export type SalaryTemplate = {
  employeeId: string;
  uid: string;
  fixedMonthlySalary: number;
  baseSalary: number;
  incentive: number;
  bonus: number;
  customAllowance: number;
  hra: number;
  studyAllowance: number;
  deduction: number;
  advanceDeduction: number;
  pf: number;
  tds: number;
  professionalTax: number;
  insurance: number;
  autoRepeat: boolean;
  effectiveFromMonth: string;
  effectiveToMonth?: string | null;
  updatedAt?: string | null;
  updatedBy?: PayrollActor | null;
};

export type SalaryOverrideInput = {
  fixedMonthlySalary?: number;
  baseSalary?: number;
  incentive?: number;
  bonus?: number;
  customAllowance?: number;
  hra?: number;
  studyAllowance?: number;
  deduction?: number;
  advanceDeduction?: number;
  pf?: number;
  tds?: number;
  professionalTax?: number;
  insurance?: number;
  netPayOverride?: number | null;
  reason?: string | null;
};

export type PayrollManualOverrides = {
  attendance?: AttendanceOverrideInput | null;
  salary?: SalaryOverrideInput | null;
};

export type PayrollSalaryBreakdown = {
  fixedMonthlySalary: number;
  baseSalary: number;
  incentive: number;
  bonus: number;
  customAllowance: number;
  hra: number;
  studyAllowance: number;
  overtimePay: number;
  attendanceAdjustment: number;
  grossSalary: number;
  deduction: number;
  advanceDeduction: number;
  pf: number;
  tds: number;
  professionalTax: number;
  insurance: number;
  totalDeductions: number;
  netPayOverride: number | null;
  netPay: number;
};

export type PayrollVersionHistoryItem = {
  id: string;
  payrollRecordId: string;
  employeeId: string;
  uid: string;
  month: string;
  version: number;
  changedAt: string | null;
  changedBy: PayrollActor | null;
  changeType: "CREATED" | "GENERATED" | "EDITED" | "APPROVED" | "SENT" | "DOWNLOADED";
};

export type PayrollDownloadEvent = {
  at: string | null;
  byUid: string;
  byName: string | null;
  role: string | null;
  source: "HR" | "EMPLOYEE";
};

export type PayrollRecord = Payroll & {
  status: PayrollWorkflowStatus;
  employee: PayrollEmployeeRecord;
  attendanceSummary: AttendanceRecord;
  salaryTemplate: SalaryTemplate;
  salaryBreakdown: PayrollSalaryBreakdown;
  manualOverrides: PayrollManualOverrides;
  version: number;
  locked: boolean;
  pdfUrl: string | null;
  downloadHistory: PayrollDownloadEvent[];
  downloadCount: number;
  generatedBy: PayrollActor | null;
  editedBy: PayrollActor | null;
  approvedBy?: PayrollActor | null;
  sentBy?: PayrollActor | null;
  sentAt?: Date;
  approvedAt?: Date;
  downloadedAt?: Date;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  isVisibleToEmployee?: boolean;
  notificationId?: string | null;
  netPay: number;
  netSalary: number;
  grossSalary: number;
  deductions: number;
};

export type GeneratePayrollRequest = {
  employeeId: string;
  month: string;
};

export type BulkGeneratePayrollRequest = {
  month: string;
};

export type SavePayrollRequest = {
  employeeId: string;
  month: string;
  attendanceOverride?: AttendanceOverrideInput | null;
  salaryOverride?: SalaryOverrideInput | null;
  saveAsTemplate?: boolean;
  finalizeGeneration?: boolean;
};

export type PayrollDetailsResponse = {
  employee: PayrollEmployeeRecord;
  attendanceSummary: AttendanceRecord;
  salaryTemplate: SalaryTemplate;
  payroll: PayrollRecord;
  exists: boolean;
  versionHistory: PayrollVersionHistoryItem[];
};

export type PayrollListItem = {
  employee: PayrollEmployeeRecord;
  payroll: PayrollRecord | null;
  attendanceSummary: AttendanceRecord | null;
  salaryTemplate: SalaryTemplate | null;
  status: PayrollRecordStatus;
  issue: string | null;
};

export type PayrollListResponse = {
  month: string;
  summary: {
    totalEmployees: number;
    totalPayout: number;
    payrollRecords: number;
    drafts: number;
    sent: number;
  };
  items: PayrollListItem[];
};

export type BulkGeneratePayrollResultItem = {
  employeeId: string;
  uid: string;
  name: string;
  status:
    | "GENERATED"
    | "ALREADY_GENERATED"
    | "MISSING_ATTENDANCE"
    | "ZERO_SALARY"
    | "INACTIVE"
    | "FAILED";
  message: string;
};

export type BulkGeneratePayrollResponse = {
  month: string;
  summary: {
    attempted: number;
    generated: number;
    alreadyGenerated: number;
    missingAttendance: number;
    zeroSalary: number;
    inactive: number;
    failed: number;
  };
  results: BulkGeneratePayrollResultItem[];
};

export type EmployeePayslipListItem = {
  id: string;
  month: string;
  status: PayrollWorkflowStatus;
  netPay: number;
  pdfUrl: string | null;
  version: number;
  sentAt: string | null;
  downloadedAt: string | null;
  downloadCount: number;
  employee: PayrollEmployeeRecord;
};

export type EmployeePayslipListResponse = {
  items: EmployeePayslipListItem[];
};
