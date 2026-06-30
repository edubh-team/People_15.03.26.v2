import {
  DEFAULT_BI_WEEKLY_TARGET_CONFIG,
  getBiWeeklyCycleIndex,
  getBiWeeklyCycleWindow,
  type BiWeeklyTargetConfig,
} from "@/lib/sales/biweekly-targets";
import type {
  BdaCounsellingCycleSummary,
  BdaCounsellingEntryDoc,
} from "@/lib/types/performance";

export const COUNSELLING_TARGET_PER_CYCLE = 15;
export const COUNSELLING_INCENTIVE_PER_ENTRY = 10;
export const COUNSELLING_PAYOUT_LOCK_REASON =
  "Payout locked until BDA reaches 3 sales across the rolling 3 bi-weekly cycles.";

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value && "seconds" in value && typeof (value as { seconds?: unknown }).seconds === "number") {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateKeyToDate(dateKey: string) {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildCounsellingEntryCycleMeta(input?: {
  date?: Date;
  config?: BiWeeklyTargetConfig;
}) {
  const config = input?.config ?? DEFAULT_BI_WEEKLY_TARGET_CONFIG;
  const date = input?.date ?? new Date();
  const cycleIndex = getBiWeeklyCycleIndex(date, config);
  const cycleWindow = getBiWeeklyCycleWindow(cycleIndex, config);
  return {
    cycleIndex,
    cycleLabel: cycleWindow.label,
    cycleStart: cycleWindow.start,
    cycleEndExclusive: cycleWindow.endExclusive,
  };
}

export function aggregateCounsellingByCycle(input: {
  entries: Array<Pick<BdaCounsellingEntryDoc, "bdaUid" | "bdaName" | "managerName" | "cycleIndex" | "cycleLabel" | "counsellingCount" | "status">>;
  cycleIndex: number;
  target?: number;
  incentivePerEntry?: number;
  payoutEligibilityByBda?: Map<string, boolean> | Record<string, boolean>;
  payoutLockedReason?: string;
}) {
  const target = Math.max(1, input.target ?? COUNSELLING_TARGET_PER_CYCLE);
  const incentivePerEntry = Math.max(0, input.incentivePerEntry ?? COUNSELLING_INCENTIVE_PER_ENTRY);
  const payoutLockedReason = input.payoutLockedReason ?? COUNSELLING_PAYOUT_LOCK_REASON;

  const rows = new Map<string, BdaCounsellingCycleSummary>();
  input.entries.forEach((entry) => {
    if (entry.cycleIndex !== input.cycleIndex) return;
    if (!rows.has(entry.bdaUid)) {
      rows.set(entry.bdaUid, {
        bdaUid: entry.bdaUid,
        bdaName: entry.bdaName,
        managerName: entry.managerName,
        cycleIndex: entry.cycleIndex,
        cycleLabel: entry.cycleLabel,
        target,
        enteredCount: 0,
        approvedCount: 0,
        pendingCount: 0,
        rejectedCount: 0,
        payoutEligible: true,
        payoutLockedReason: null,
        payoutAmount: 0,
      });
    }

    const row = rows.get(entry.bdaUid)!;
    const count = Math.max(0, Number(entry.counsellingCount || 0));
    row.enteredCount += count;
    if (entry.status === "approved") row.approvedCount += count;
    else if (entry.status === "rejected") row.rejectedCount += count;
    else row.pendingCount += count;

    let payoutEligible = true;
    if (input.payoutEligibilityByBda instanceof Map) {
      payoutEligible = input.payoutEligibilityByBda.get(entry.bdaUid) ?? false;
    } else if (input.payoutEligibilityByBda && typeof input.payoutEligibilityByBda === "object") {
      payoutEligible = Boolean((input.payoutEligibilityByBda as Record<string, boolean>)[entry.bdaUid]);
    }

    row.payoutEligible = payoutEligible;
    row.payoutLockedReason = payoutEligible ? null : payoutLockedReason;
    row.payoutAmount = payoutEligible ? row.approvedCount * incentivePerEntry : 0;
  });

  return Array.from(rows.values()).sort((left, right) => {
    if (right.payoutAmount !== left.payoutAmount) return right.payoutAmount - left.payoutAmount;
    return left.bdaName.localeCompare(right.bdaName);
  });
}

export function buildCounsellingFinanceExportCsv(input: {
  rows: BdaCounsellingCycleSummary[];
  cycleLabel: string;
  generatedAt?: Date;
}) {
  const generatedAt = input.generatedAt ?? new Date();
  const header = [
    "bda_uid",
    "bda_name",
    "manager_name",
    "cycle_label",
    "approved_counselling_count",
    "payout_eligible",
    "payout_lock_reason",
    "incentive_per_entry",
    "payout_amount",
    "generated_at_iso",
  ];
  const lines = [header.join(",")];
  input.rows.forEach((row) => {
    lines.push(
      [
        row.bdaUid,
        row.bdaName,
        row.managerName,
        input.cycleLabel,
        String(row.approvedCount),
        row.payoutEligible ? "yes" : "no",
        row.payoutLockedReason ?? "",
        String(COUNSELLING_INCENTIVE_PER_ENTRY),
        String(row.payoutAmount),
        generatedAt.toISOString(),
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(","),
    );
  });
  return lines.join("\n");
}

export function resolveCounsellingEntryDate(value: unknown) {
  const parsed = toDate(value);
  if (!parsed) return null;
  return parsed;
}
