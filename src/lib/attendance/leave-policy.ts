export const MONTHLY_LEAVE_ALLOWANCE_DAYS = 14;
export const PAYROLL_MONTH_DAYS = 30;

type LeaveRangeOptions = {
  includeSaturdayAsLeave?: boolean;
  monthKey?: string;
};

export type LeaveRangeBreakdown = {
  totalCalendarDays: number;
  chargeableLeaveDays: number;
  saturdayDays: number;
  sundayDays: number;
  saturdayExcludedDays: number;
  sundayExcludedDays: number;
  consideredDateKeys: string[];
};

export type MonthlyLeaveDeductionInput = {
  approvedChargeableDays: number;
  baseSalary: number;
  monthlyAllowanceDays?: number;
  payrollMonthDays?: number;
};

export type MonthlyLeaveDeductionSummary = {
  approvedChargeableDays: number;
  allowanceDays: number;
  excessLeaveDays: number;
  perDaySalary: number;
  deductionAmount: number;
};

export type LeaveRequestPolicyLike = {
  uid?: string | null;
  status?: string | null;
  startDateKey?: string | null;
  endDateKey?: string | null;
  includeSaturdayAsLeave?: boolean | null;
  weekendPolicy?: {
    includeSaturdayAsLeave?: boolean | null;
  } | null;
};

export type MonthlyLeaveUserSummary = {
  chargeableLeaveDays: number;
  totalCalendarDays: number;
  saturdayExcludedDays: number;
  sundayExcludedDays: number;
};

function isValidMonthKey(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function toDateKey(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function enumerateDateKeysInclusive(startDateKey: string, endDateKey: string) {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  if (!start || !end || start.getTime() > end.getTime()) return [] as string[];

  const keys: string[] = [];
  const cursor = new Date(start);

  // Guardrail for malformed ranges.
  while (cursor.getTime() <= end.getTime() && keys.length < 500) {
    keys.push(toDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

export function isApprovedLeaveStatus(status: string | null | undefined) {
  return (status ?? "").toLowerCase() === "approved";
}

export function calculateLeaveRangeBreakdown(
  startDateKey: string,
  endDateKey: string,
  options: LeaveRangeOptions = {},
): LeaveRangeBreakdown {
  const includeSaturdayAsLeave = options.includeSaturdayAsLeave === true;
  const monthKey = options.monthKey?.trim() ?? "";
  const shouldScopeByMonth = monthKey.length > 0 && isValidMonthKey(monthKey);
  const allDateKeys = enumerateDateKeysInclusive(startDateKey, endDateKey);
  const consideredDateKeys = shouldScopeByMonth
    ? allDateKeys.filter((key) => key.startsWith(`${monthKey}-`))
    : allDateKeys;

  let chargeableLeaveDays = 0;
  let saturdayDays = 0;
  let sundayDays = 0;
  let saturdayExcludedDays = 0;
  let sundayExcludedDays = 0;

  consideredDateKeys.forEach((key) => {
    const parsed = parseDateKey(key);
    if (!parsed) return;
    const dayOfWeek = parsed.getUTCDay();
    if (dayOfWeek === 0) {
      sundayDays += 1;
      sundayExcludedDays += 1;
      return;
    }
    if (dayOfWeek === 6) {
      saturdayDays += 1;
      if (!includeSaturdayAsLeave) {
        saturdayExcludedDays += 1;
        return;
      }
    }
    chargeableLeaveDays += 1;
  });

  return {
    totalCalendarDays: consideredDateKeys.length,
    chargeableLeaveDays,
    saturdayDays,
    sundayDays,
    saturdayExcludedDays,
    sundayExcludedDays,
    consideredDateKeys,
  };
}

export function calculateMonthlyLeaveDeduction(
  input: MonthlyLeaveDeductionInput,
): MonthlyLeaveDeductionSummary {
  const approvedChargeableDays = Math.max(0, Math.floor(Number(input.approvedChargeableDays) || 0));
  const allowanceDays = Math.max(
    0,
    Math.floor(Number(input.monthlyAllowanceDays ?? MONTHLY_LEAVE_ALLOWANCE_DAYS) || 0),
  );
  const payrollMonthDays = Math.max(
    1,
    Math.floor(Number(input.payrollMonthDays ?? PAYROLL_MONTH_DAYS) || PAYROLL_MONTH_DAYS),
  );
  const baseSalary = Math.max(0, Number(input.baseSalary) || 0);
  const excessLeaveDays = Math.max(0, approvedChargeableDays - allowanceDays);
  const perDaySalary = baseSalary / payrollMonthDays;
  const deductionAmount = Math.max(0, Math.round(perDaySalary * excessLeaveDays));

  return {
    approvedChargeableDays,
    allowanceDays,
    excessLeaveDays,
    perDaySalary,
    deductionAmount,
  };
}

function includeSaturdayFromRequest(request: LeaveRequestPolicyLike) {
  if (typeof request.includeSaturdayAsLeave === "boolean") {
    return request.includeSaturdayAsLeave;
  }
  return request.weekendPolicy?.includeSaturdayAsLeave === true;
}

export function buildMonthlyApprovedLeaveSummaryByUser(
  requests: LeaveRequestPolicyLike[],
  monthKey: string,
) {
  const summaryByUid: Record<string, MonthlyLeaveUserSummary> = {};
  if (!isValidMonthKey(monthKey)) return summaryByUid;

  requests.forEach((request) => {
    if (!isApprovedLeaveStatus(request.status)) return;
    const uid = request.uid?.trim();
    if (!uid || !request.startDateKey || !request.endDateKey) return;

    const breakdown = calculateLeaveRangeBreakdown(request.startDateKey, request.endDateKey, {
      monthKey,
      includeSaturdayAsLeave: includeSaturdayFromRequest(request),
    });
    if (breakdown.totalCalendarDays <= 0) return;

    if (!summaryByUid[uid]) {
      summaryByUid[uid] = {
        chargeableLeaveDays: 0,
        totalCalendarDays: 0,
        saturdayExcludedDays: 0,
        sundayExcludedDays: 0,
      };
    }

    summaryByUid[uid].chargeableLeaveDays += breakdown.chargeableLeaveDays;
    summaryByUid[uid].totalCalendarDays += breakdown.totalCalendarDays;
    summaryByUid[uid].saturdayExcludedDays += breakdown.saturdayExcludedDays;
    summaryByUid[uid].sundayExcludedDays += breakdown.sundayExcludedDays;
  });

  return summaryByUid;
}
