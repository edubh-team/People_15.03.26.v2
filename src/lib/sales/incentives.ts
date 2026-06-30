import type { UserDoc } from "@/lib/types/user";

export const BDA_PROBATION_MONTHS = 6;
export const BDA_PROBATION_INCENTIVE_PER_SALE = 500;
export const BDA_POST_PROBATION_INCENTIVE_UPTO_FIVE = [1500, 1500, 2000, 2000, 5000] as const;
export const BDA_POST_PROBATION_INCENTIVE_SIXTH_ONWARDS = 10000;
export const COUNSELLING_PAYOUT_MIN_ROLLING_SALES = 3;

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (
    typeof value === "object" &&
    value &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    typeof value === "object" &&
    value &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function monthWindow(referenceDate: Date) {
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);
  const endExclusive = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, endExclusive };
}

export function resolveEmploymentStartDate(user: Partial<UserDoc> | null | undefined) {
  if (!user) return null;
  const asRecord = user as Record<string, unknown>;
  return (
    toDate(asRecord.joinedAt) ||
    toDate(asRecord.joiningDate) ||
    toDate(user.onboardingTimestamp) ||
    toDate(user.createdAt) ||
    null
  );
}

export function isBdaInProbation(startDate: Date | null, referenceDate = new Date()) {
  if (!startDate) return false;
  const probationEnd = new Date(startDate);
  probationEnd.setMonth(probationEnd.getMonth() + BDA_PROBATION_MONTHS);
  return referenceDate.getTime() < probationEnd.getTime();
}

export function countSalesInMonth(saleDates: Date[], referenceDate = new Date()) {
  const { start, endExclusive } = monthWindow(referenceDate);
  return saleDates.reduce((total, dateValue) => {
    const ts = dateValue.getTime();
    if (Number.isNaN(ts)) return total;
    if (ts >= start.getTime() && ts < endExclusive.getTime()) return total + 1;
    return total;
  }, 0);
}

export function calculateBdaSalesIncentiveForCount(input: {
  salesCount: number;
  probation: boolean;
}) {
  const salesCount = Math.max(0, Math.trunc(Number(input.salesCount || 0)));
  if (salesCount === 0) return 0;
  if (input.probation) return salesCount * BDA_PROBATION_INCENTIVE_PER_SALE;

  let total = 0;
  for (let saleIndex = 1; saleIndex <= salesCount; saleIndex += 1) {
    if (saleIndex <= BDA_POST_PROBATION_INCENTIVE_UPTO_FIVE.length) {
      total += BDA_POST_PROBATION_INCENTIVE_UPTO_FIVE[saleIndex - 1];
    } else {
      total += BDA_POST_PROBATION_INCENTIVE_SIXTH_ONWARDS;
    }
  }
  return total;
}

export function buildBdaMonthlySalesIncentiveSummary(input: {
  saleDates: Date[];
  user: Partial<UserDoc> | null | undefined;
  referenceDate?: Date;
}) {
  const referenceDate = input.referenceDate ?? new Date();
  const monthSalesCount = countSalesInMonth(input.saleDates, referenceDate);
  const employmentStart = resolveEmploymentStartDate(input.user);
  const probation = isBdaInProbation(employmentStart, referenceDate);
  const incentiveAmount = calculateBdaSalesIncentiveForCount({
    salesCount: monthSalesCount,
    probation,
  });

  return {
    monthSalesCount,
    probation,
    incentiveAmount,
    employmentStart,
  };
}

export function isCounsellingPayoutEligible(rollingThreeCycleSales: number) {
  return Math.max(0, Number(rollingThreeCycleSales || 0)) >= COUNSELLING_PAYOUT_MIN_ROLLING_SALES;
}
