export type AttendanceSummary = {
  totalWorkedMinutes: number;
  daysPresent: number;
  daysLate: number;
  daysOnLeave: number;
};

export type PerformanceSummary = {
  leadsClosed: number;
  conversionRate: number;
};

export type PayoutInput = {
  baseSalary: number;
  salaryStructure?: {
    bonusRate: number;
    deductionRate: number;
  } | null;
  attendance: AttendanceSummary;
  performance: PerformanceSummary;
};

export type Payout = {
  month: string;
  base: number;
  bonus: number;
  deductions: number;
  net: number;
  breakdown: {
    attendanceMinutes: number;
    leadsClosed: number;
    conversionRate: number;
  };
};

export function computeMonthlyPayout(input: PayoutInput, month: string): Payout {
  const base = input.baseSalary;
  const bonusRate = input.salaryStructure?.bonusRate ?? 0;
  const deductionRate = input.salaryStructure?.deductionRate ?? 0;
  const bonus = Math.max(0, Math.round(input.performance.leadsClosed * bonusRate));
  const deficitHours = Math.max(0, (22 * 8 * 60) - input.attendance.totalWorkedMinutes);
  const deductions = Math.round((deficitHours / 60) * deductionRate);
  const net = Math.max(0, base + bonus - deductions);
  return {
    month,
    base,
    bonus,
    deductions,
    net,
    breakdown: {
      attendanceMinutes: input.attendance.totalWorkedMinutes,
      leadsClosed: input.performance.leadsClosed,
      conversionRate: input.performance.conversionRate,
    },
  };
}
