import type {
  Payroll,
  PayrollDeductionsBreakdown,
  PayrollEarningsBreakdown,
} from "@/lib/types/hr";

export type PayrollRecordStatus =
  | "GENERATED"
  | "PAID"
  | "NOT_GENERATED"
  | "ZERO_SALARY"
  | "MISSING_ATTENDANCE";

export type PayrollEmployeeRecord = {
  id: string;
  uid: string;
  name: string;
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
  daysPresent: number;
  daysAbsent: number;
  lateCount: number;
  leavesApproved: number;
};

export type GeneratePayrollRequest = {
  employeeId: string;
  month: string;
  bonus?: number;
};

export type BulkGeneratePayrollRequest = {
  month: string;
};

export type PayrollDetailsResponse = {
  employee: PayrollEmployeeRecord;
  attendance: AttendanceRecord;
  payroll: Payroll;
  defaultComponents: {
    earnings: PayrollEarningsBreakdown;
    deductionBreakdown: PayrollDeductionsBreakdown;
  };
};

export type PayrollListItem = {
  employee: PayrollEmployeeRecord;
  payroll: Payroll | null;
  status: PayrollRecordStatus;
  issue: string | null;
};

export type PayrollListResponse = {
  month: string;
  summary: {
    totalEmployees: number;
    totalPayout: number;
    payrollRecords: number;
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
