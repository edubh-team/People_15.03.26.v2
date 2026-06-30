export type BiWeeklyStatus = "on_track" | "at_risk" | "missed";

export type BiWeeklyTargetConfig = {
  anchorDateIso: string;
  cycleDays: number;
  salesTargetPerCycle: number;
  rollingCycles: number;
};

export type BiWeeklyCycleWindow = {
  index: number;
  start: Date;
  endExclusive: Date;
  label: string;
};

export type BiWeeklyCycleScore = {
  index: number;
  label: string;
  sales: number;
  target: number;
  metTarget: boolean;
  start: Date;
  endExclusive: Date;
};

export type BdaBiWeeklyScorecard = {
  uid: string;
  name: string;
  managerName: string;
  status: BiWeeklyStatus;
  currentCycle: BiWeeklyCycleScore;
  rollingCycles: BiWeeklyCycleScore[];
  rollingSales: number;
  rollingTarget: number;
  metCycles: number;
  referenceDate: Date;
};

export const DEFAULT_BI_WEEKLY_TARGET_CONFIG: BiWeeklyTargetConfig = {
  anchorDateIso: "2026-01-05T00:00:00.000Z",
  cycleDays: 14,
  salesTargetPerCycle: 1,
  rollingCycles: 3,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateStart(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatDateLabel(value: Date) {
  const dd = String(value.getDate()).padStart(2, "0");
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

export function getBiWeeklyAnchorDate(config: BiWeeklyTargetConfig = DEFAULT_BI_WEEKLY_TARGET_CONFIG) {
  const anchor = new Date(config.anchorDateIso);
  if (Number.isNaN(anchor.getTime())) {
    return toDateStart(new Date("2026-01-05T00:00:00.000Z"));
  }
  return toDateStart(anchor);
}

export function getBiWeeklyCycleIndex(referenceDate: Date, config: BiWeeklyTargetConfig = DEFAULT_BI_WEEKLY_TARGET_CONFIG) {
  const anchor = getBiWeeklyAnchorDate(config).getTime();
  const ref = toDateStart(referenceDate).getTime();
  const cycleMs = config.cycleDays * DAY_MS;
  return Math.floor((ref - anchor) / cycleMs);
}

export function getBiWeeklyCycleWindow(
  cycleIndex: number,
  config: BiWeeklyTargetConfig = DEFAULT_BI_WEEKLY_TARGET_CONFIG,
): BiWeeklyCycleWindow {
  const anchor = getBiWeeklyAnchorDate(config);
  const start = new Date(anchor.getTime() + cycleIndex * config.cycleDays * DAY_MS);
  const endExclusive = new Date(start.getTime() + config.cycleDays * DAY_MS);
  const endInclusive = new Date(endExclusive.getTime() - DAY_MS);
  return {
    index: cycleIndex,
    start,
    endExclusive,
    label: `${formatDateLabel(start)} - ${formatDateLabel(endInclusive)}`,
  };
}

export function buildRollingBiWeeklyCycleWindows(
  referenceDate: Date,
  config: BiWeeklyTargetConfig = DEFAULT_BI_WEEKLY_TARGET_CONFIG,
) {
  const latestIndex = getBiWeeklyCycleIndex(referenceDate, config);
  const windows: BiWeeklyCycleWindow[] = [];
  for (let offset = config.rollingCycles - 1; offset >= 0; offset -= 1) {
    windows.push(getBiWeeklyCycleWindow(latestIndex - offset, config));
  }
  return windows;
}

function countSalesInWindow(saleDates: Date[], window: BiWeeklyCycleWindow) {
  return saleDates.reduce((total, date) => {
    const ts = date.getTime();
    if (ts >= window.start.getTime() && ts < window.endExclusive.getTime()) {
      return total + 1;
    }
    return total;
  }, 0);
}

export function buildBdaBiWeeklyScorecard(input: {
  uid: string;
  name: string;
  managerName: string;
  saleDates: Date[];
  referenceDate?: Date;
  config?: BiWeeklyTargetConfig;
}): BdaBiWeeklyScorecard {
  const config = input.config ?? DEFAULT_BI_WEEKLY_TARGET_CONFIG;
  const referenceDate = input.referenceDate ?? new Date();
  const windows = buildRollingBiWeeklyCycleWindows(referenceDate, config);
  const rollingCycles: BiWeeklyCycleScore[] = windows.map((window) => {
    const sales = countSalesInWindow(input.saleDates, window);
    return {
      index: window.index,
      label: window.label,
      sales,
      target: config.salesTargetPerCycle,
      metTarget: sales >= config.salesTargetPerCycle,
      start: window.start,
      endExclusive: window.endExclusive,
    };
  });

  const rollingSales = rollingCycles.reduce((total, cycle) => total + cycle.sales, 0);
  const rollingTarget = config.salesTargetPerCycle * config.rollingCycles;
  const metCycles = rollingCycles.filter((cycle) => cycle.metTarget).length;
  const status: BiWeeklyStatus =
    rollingSales >= rollingTarget
      ? "on_track"
      : rollingSales === Math.max(rollingTarget - 1, 0)
        ? "at_risk"
        : "missed";

  return {
    uid: input.uid,
    name: input.name,
    managerName: input.managerName,
    status,
    currentCycle: rollingCycles[rollingCycles.length - 1],
    rollingCycles,
    rollingSales,
    rollingTarget,
    metCycles,
    referenceDate,
  };
}

export function summarizeBiWeeklyScorecards(rows: BdaBiWeeklyScorecard[]) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;
      summary.totalRollingSales += row.rollingSales;
      if (row.status === "on_track") summary.onTrack += 1;
      if (row.status === "at_risk") summary.atRisk += 1;
      if (row.status === "missed") summary.missed += 1;
      return summary;
    },
    {
      total: 0,
      onTrack: 0,
      atRisk: 0,
      missed: 0,
      totalRollingSales: 0,
    },
  );
}

