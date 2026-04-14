
import { Timestamp } from "firebase/firestore";

export type CandidateStatus = "Applied" | "Screening" | "Interview" | "Selected" | "Rejected";

export interface Candidate {
  id: string;
  name: string;
  email: string;
  roleApplied: string;
  resumeUrl?: string;
  status: CandidateStatus;
  interviewDate?: Timestamp | Date;
  notes?: string;
  createdAt: Timestamp | Date;
}

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface LeaveRequest {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  type: string;
  startDate: Timestamp | Date;
  endDate: Timestamp | Date;
  days?: number;
  reason: string;
  status: LeaveStatus;
  adminComment?: string;
  createdAt: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

export interface PayrollLineItem {
  label: string;
  amount: number;
}

export interface PayrollEarningsBreakdown {
  basicSalary: number;
  studyAllowance: number;
  bonus: number;
  hra: number;
}

export interface PayrollDeductionsBreakdown {
  lop: number;
  professionalTax: number;
  pf: number;
  insurance: number;
}

export interface AttendancePayrollSummary {
  employeeId: string;
  uid: string;
  month: string;
  daysPresent: number;
  daysAbsent: number;
  lateCount: number;
  leavesApproved: number;
}

export interface Payroll {
  id: string; // {uid}_{month_year}
  uid: string;
  month: string; // YYYY-MM
  employeeId?: string;
  designation?: string;
  department?: string;
  joiningDate?: string | null;
  basicSalary?: number;
  baseSalary: number;
  daysPresent: number;
  daysAbsent: number;
  lates: number;
  lateCount?: number;
  incentives: number;
  bonus?: number; // Added for manual bonus
  bonuses?: number;
  commissionPercentage?: number; // % of sales volume
  totalSalesVolume?: number; // Snapshot of sales volume for this payroll
  deductions: number;
  lateDeduction?: number;
  leaveApprovedDays?: number;
  paidLeaveDays?: number;
  leaveAllowanceDays?: number;
  leaveExcessDays?: number;
  unpaidLeaveDays?: number;
  leaveDeduction?: number;
  saturdayExcludedDays?: number;
  sundayExcludedDays?: number;
  attendanceCorrectionCount?: number;
  attendanceCorrectionPendingCount?: number;
  attendanceCorrectionReasons?: string[];
  attendanceCorrectionSummary?: string | null;
  grossSalary?: number;
  netPay?: number;
  netSalary: number;
  paymentPeriodStart?: string | null;
  paymentPeriodEnd?: string | null;
  paymentDate?: string | null;
  earnings?: PayrollEarningsBreakdown | PayrollLineItem[];
  deductionBreakdown?: PayrollDeductionsBreakdown;
  deductionItems?: PayrollLineItem[];
  status: "GENERATED" | "PAID" | "PENDING_CREATION";
  payslipUrl?: string;
  generatedAt: Timestamp | Date;
  paidAt?: Timestamp | Date;
  userDisplayName?: string;
  userEmail?: string;
}
