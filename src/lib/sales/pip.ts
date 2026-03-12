import {
  getBiWeeklyCycleWindow,
  type BdaBiWeeklyScorecard,
  type BiWeeklyTargetConfig,
  DEFAULT_BI_WEEKLY_TARGET_CONFIG,
} from "@/lib/sales/biweekly-targets";
import type { BdaPipCaseDoc, PipCaseStatus, PerformanceActor } from "@/lib/types/performance";

export const DEFAULT_PIP_TARGET_SALES = 2;

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

function countSalesInWindow(saleDates: Date[], start: Date, endExclusive: Date) {
  const startMs = start.getTime();
  const endMs = endExclusive.getTime();
  return saleDates.reduce((total, date) => {
    const ts = date.getTime();
    if (ts >= startMs && ts < endMs) return total + 1;
    return total;
  }, 0);
}

export function getPipCaseId(bdaUid: string, triggerCycleIndex: number) {
  return `pip_${bdaUid}_${triggerCycleIndex}`;
}

export function buildPipCaseFromMissedScorecard(input: {
  scorecard: BdaBiWeeklyScorecard;
  targetSales?: number;
  now?: Date;
  config?: BiWeeklyTargetConfig;
}): BdaPipCaseDoc {
  const now = input.now ?? new Date();
  const config = input.config ?? DEFAULT_BI_WEEKLY_TARGET_CONFIG;
  const pipCycleIndex = input.scorecard.currentCycle.index + 1;
  const pipWindow = getBiWeeklyCycleWindow(pipCycleIndex, config);
  const target = Math.max(1, input.targetSales ?? DEFAULT_PIP_TARGET_SALES);
  return {
    id: getPipCaseId(input.scorecard.uid, input.scorecard.currentCycle.index),
    bdaUid: input.scorecard.uid,
    bdaName: input.scorecard.name,
    managerUid: null,
    managerName: input.scorecard.managerName,
    triggerStatus: input.scorecard.status,
    triggerCycleIndex: input.scorecard.currentCycle.index,
    triggerCycleLabel: input.scorecard.currentCycle.label,
    pipCycleIndex,
    pipCycleLabel: pipWindow.label,
    pipCycleStart: pipWindow.start,
    pipCycleEndExclusive: pipWindow.endExclusive,
    pipTargetSales: target,
    pipAchievedSales: 0,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastEvaluatedAt: now,
    lastEvaluatedBy: null,
    failAction: null,
    failActionAt: null,
    failActionBy: null,
    failActionReason: null,
  };
}

export function evaluatePipCase(input: {
  pipCase: Pick<
    BdaPipCaseDoc,
    | "status"
    | "pipTargetSales"
    | "pipAchievedSales"
    | "pipCycleStart"
    | "pipCycleEndExclusive"
    | "resolvedAt"
    | "resolutionNote"
  >;
  saleDates: Date[];
  now?: Date;
  actor?: PerformanceActor | null;
}) {
  const now = input.now ?? new Date();
  const start = toDate(input.pipCase.pipCycleStart);
  const endExclusive = toDate(input.pipCase.pipCycleEndExclusive);
  if (!start || !endExclusive) {
    return null;
  }

  const achieved = countSalesInWindow(input.saleDates, start, endExclusive);
  const target = Math.max(1, Number(input.pipCase.pipTargetSales || 0));
  let status: PipCaseStatus = "active";
  let resolutionNote: string | null = null;
  let resolvedAt: Date | null = null;

  if (achieved >= target) {
    status = "passed";
    resolutionNote = `Target met in PIP cycle (${achieved}/${target}).`;
    resolvedAt = now;
  } else if (now.getTime() >= endExclusive.getTime()) {
    status = "failed";
    resolutionNote = `Target missed in PIP cycle (${achieved}/${target}).`;
    resolvedAt = now;
  }

  const changed =
    status !== input.pipCase.status ||
    achieved !== Number(input.pipCase.pipAchievedSales || 0) ||
    (status !== "active" && !input.pipCase.resolvedAt);

  if (!changed) return null;

  return {
    status,
    pipAchievedSales: achieved,
    updatedAt: now,
    resolvedAt,
    resolutionNote,
    lastEvaluatedAt: now,
    lastEvaluatedBy: input.actor ?? null,
  };
}
