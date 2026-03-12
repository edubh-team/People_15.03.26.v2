import type { BiWeeklyStatus } from "@/lib/sales/biweekly-targets";

export type PerformanceActor = {
  uid: string;
  name: string | null;
  role: string | null;
  employeeId?: string | null;
};

export type PipCaseStatus = "active" | "passed" | "failed";

export type PipFailureAction = "extend_inactive" | "set_inactive_window" | "terminate";

export type BdaPipCaseDoc = {
  id: string;
  bdaUid: string;
  bdaName: string;
  managerUid: string | null;
  managerName: string;
  triggerStatus: BiWeeklyStatus;
  triggerCycleIndex: number;
  triggerCycleLabel: string;
  pipCycleIndex: number;
  pipCycleLabel: string;
  pipCycleStart: unknown;
  pipCycleEndExclusive: unknown;
  pipTargetSales: number;
  pipAchievedSales: number;
  status: PipCaseStatus;
  createdAt: unknown;
  updatedAt: unknown;
  resolvedAt?: unknown;
  resolutionNote?: string | null;
  lastEvaluatedAt?: unknown;
  lastEvaluatedBy?: PerformanceActor | null;
  failAction?: PipFailureAction | null;
  failActionAt?: unknown;
  failActionBy?: PerformanceActor | null;
  failActionReason?: string | null;
  inactiveUntil?: unknown;
};

export type CounsellingReviewStatus = "pending" | "approved" | "rejected";

export type BdaCounsellingEntryDoc = {
  id: string;
  bdaUid: string;
  bdaName: string;
  managerUid: string | null;
  managerName: string;
  cycleIndex: number;
  cycleLabel: string;
  entryDateKey: string;
  counsellingCount: number;
  notes?: string | null;
  status: CounsellingReviewStatus;
  createdAt: unknown;
  updatedAt: unknown;
  reviewedAt?: unknown;
  reviewedBy?: PerformanceActor | null;
  reviewNote?: string | null;
};

export type BdaCounsellingCycleSummary = {
  bdaUid: string;
  bdaName: string;
  managerName: string;
  cycleIndex: number;
  cycleLabel: string;
  target: number;
  enteredCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  payoutEligible: boolean;
  payoutLockedReason: string | null;
  payoutAmount: number;
};

export type BdaEmiTrackerDoc = {
  id: string;
  bdaUid: string;
  bdaName: string;
  totalEmiCount: number;
  paidEmiCount: number;
  remainingEmiCount: number;
  monthlyEmiAmount: number;
  loanAmount?: number | null;
  monthWisePaid?: Record<string, number> | null;
  createdAt: unknown;
  updatedAt: unknown;
  updatedBy?: PerformanceActor | null;
};
