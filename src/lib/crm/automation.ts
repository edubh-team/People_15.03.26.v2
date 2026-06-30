import { getPrimaryRole } from "@/lib/access";
import {
  PAYMENT_FOLLOW_UP_STATUS,
  isClosedLeadStatus,
  isPaymentFollowUpStatus,
  normalizeLeadStatus,
} from "@/lib/leads/status";
import { getHierarchyScopedUsers } from "@/lib/sales/hierarchy";
import type { LeadDoc } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";

export const DEFAULT_CRM_DAILY_CAPACITY = 30;
export const DEFAULT_CRM_STALE_LEAD_HOURS = 24;
export const DEFAULT_CRM_OVERDUE_ESCALATION_DAYS = 1;
export const CRM_WORKFLOW_TASK_TYPES = [
  "lead_follow_up",
  "lead_payment_review",
  "lead_reactivation",
  "lead_sla_recovery",
  "lead_manager_escalation",
] as const;

export type RoutingPresenceSnapshot = {
  status?: string | null;
  dateKey?: string | null;
};

export type CrmRoutingCandidateSnapshot = {
  user: UserDoc;
  presence: RoutingPresenceSnapshot | null;
  assignedToday: number;
  openLeadCount: number;
  staleLeadCount: number;
  overdueFollowUpCount: number;
  dailyCapacity: number;
  maxOpenLeads: number | null;
};

export type LeadSlaBucket = "none" | "due_today" | "overdue";
export type CrmWorkflowTaskType = typeof CRM_WORKFLOW_TASK_TYPES[number];
export type CrmWorkflowTaskPriority = "low" | "medium" | "high";

export type CrmWorkflowTaskDefinition = {
  type: CrmWorkflowTaskType;
  assigneeUid: string;
  title: string;
  description: string;
  category: string;
  priority: CrmWorkflowTaskPriority;
  deadline: Date | null;
  source: "crm_status_automation" | "crm_activity_automation" | "crm_cron_automation";
};

type LeadWorkflowSnapshot = Pick<
  LeadDoc,
  | "leadId"
  | "name"
  | "status"
  | "assignedTo"
  | "ownerUid"
  | "targetDegree"
  | "targetUniversity"
  | "nextFollowUp"
  | "nextFollowUpDateKey"
  | "lastContactDateKey"
  | "lastActionAt"
  | "lastActivityAt"
  | "updatedAt"
  | "createdAt"
  | "subStatus"
  | "enrollmentDetails"
>;

type LeadWorkflowContextInput = {
  lead: LeadWorkflowSnapshot;
  status?: string | null;
  followUpDate?: Date | null;
  remarks?: string | null;
  stage?: string | null;
  reason?: string | null;
  now?: Date;
  staleLeadHours?: number;
  overdueEscalationDays?: number;
  supervisorUid?: string | null;
  source?: CrmWorkflowTaskDefinition["source"];
};

function getRoutingName(user: UserDoc) {
  return user.displayName?.trim() || user.email?.trim() || user.uid;
}

function isActiveUser(user: UserDoc) {
  return (user.status ?? "inactive") === "active";
}

function isIndividualContributor(user: UserDoc) {
  const role = getPrimaryRole(user);
  return (
    role === "EMPLOYEE" ||
    role === "BDA" ||
    role === "BDA_TRAINEE" ||
    role === "CHANNEL_PARTNER"
  );
}

export function canReceiveAutoAssignedLeads(user: UserDoc) {
  if (!isActiveUser(user)) return false;
  if (user.autoAssignLeads === false) return false;

  const role = getPrimaryRole(user);
  return role === "TEAM_LEAD" || isIndividualContributor(user);
}

export function getCrmDailyCapacity(user: UserDoc) {
  if (typeof user.crmDailyLeadCapacity === "number" && user.crmDailyLeadCapacity > 0) {
    return Math.floor(user.crmDailyLeadCapacity);
  }

  if (typeof user.monthlyTarget === "number" && user.monthlyTarget > 0) {
    return Math.max(6, Math.ceil(user.monthlyTarget / 22));
  }

  return DEFAULT_CRM_DAILY_CAPACITY;
}

export function getCrmMaxOpenLeads(user: UserDoc) {
  if (typeof user.crmMaxOpenLeads === "number" && user.crmMaxOpenLeads > 0) {
    return Math.floor(user.crmMaxOpenLeads);
  }
  return null;
}

export function isUserAvailableForRouting(
  presence: RoutingPresenceSnapshot | null,
  todayKey: string,
) {
  if (!presence) return false;
  if (presence.status !== "checked_in") return false;
  if (!presence.dateKey) return true;
  return presence.dateKey === todayKey;
}

export function getCrmRoutingCandidatesForOwner(owner: UserDoc, users: UserDoc[]) {
  const scopedUsers = getHierarchyScopedUsers(owner, users, { includeCurrentUser: false }).filter(
    (user) => user.uid !== owner.uid && canReceiveAutoAssignedLeads(user),
  );

  if (scopedUsers.length > 0) {
    return scopedUsers;
  }

  if (canReceiveAutoAssignedLeads(owner)) {
    return [owner];
  }

  return [];
}

export function rankCrmRoutingCandidates(
  snapshots: CrmRoutingCandidateSnapshot[],
  todayKey: string,
) {
  const workloadPressure = (snapshot: CrmRoutingCandidateSnapshot) =>
    snapshot.overdueFollowUpCount * 4 + snapshot.staleLeadCount * 2 + snapshot.openLeadCount;
  const isOpenCapacityCapped = (snapshot: CrmRoutingCandidateSnapshot) =>
    snapshot.maxOpenLeads != null && snapshot.openLeadCount >= snapshot.maxOpenLeads;

  return [...snapshots].sort((left, right) => {
    const leftAvailable = isUserAvailableForRouting(left.presence, todayKey);
    const rightAvailable = isUserAvailableForRouting(right.presence, todayKey);
    if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1;

    const leftOpenCapped = isOpenCapacityCapped(left);
    const rightOpenCapped = isOpenCapacityCapped(right);
    if (leftOpenCapped !== rightOpenCapped) return leftOpenCapped ? 1 : -1;

    const leftHasCapacity = left.assignedToday < left.dailyCapacity;
    const rightHasCapacity = right.assignedToday < right.dailyCapacity;
    if (leftHasCapacity !== rightHasCapacity) return leftHasCapacity ? -1 : 1;

    const leftPressure = workloadPressure(left);
    const rightPressure = workloadPressure(right);
    if (leftPressure !== rightPressure) return leftPressure - rightPressure;

    const leftUtilization = left.assignedToday / Math.max(left.dailyCapacity, 1);
    const rightUtilization = right.assignedToday / Math.max(right.dailyCapacity, 1);
    if (leftUtilization !== rightUtilization) return leftUtilization - rightUtilization;

    if (left.openLeadCount !== right.openLeadCount) {
      return left.openLeadCount - right.openLeadCount;
    }

    if (left.assignedToday !== right.assignedToday) {
      return left.assignedToday - right.assignedToday;
    }

    return getRoutingName(left.user).localeCompare(getRoutingName(right.user));
  });
}

export function buildCrmRoutingAssignments(
  snapshots: CrmRoutingCandidateSnapshot[],
  leadKeys: string[],
  todayKey: string,
  options?: {
    overrideAssigneeUid?: string | null;
    fairnessGuardrailRatio?: number;
  },
) {
  const working = snapshots.map((snapshot) => ({ ...snapshot }));
  const assignments = new Map<string, string | null>();
  const runAssignedByUid = new Map<string, number>();
  const fairnessGuardrailRatio = options?.fairnessGuardrailRatio ?? 0.7;

  const hasOpenCapacity = (snapshot: CrmRoutingCandidateSnapshot) =>
    snapshot.maxOpenLeads == null || snapshot.openLeadCount < snapshot.maxOpenLeads;
  const violatesFairnessGuardrail = (
    uid: string,
    currentIteration: number,
    candidateCount: number,
  ) => {
    if (candidateCount <= 1) return false;
    const nextCount = (runAssignedByUid.get(uid) ?? 0) + 1;
    const nextTotal = currentIteration + 1;
    return nextCount / Math.max(nextTotal, 1) > fairnessGuardrailRatio;
  };

  leadKeys.forEach((leadKey, index) => {
    const ranked = rankCrmRoutingCandidates(working, todayKey);
    const overrideCandidate =
      options?.overrideAssigneeUid
        ? ranked.find(
            (snapshot) =>
              snapshot.user.uid === options.overrideAssigneeUid &&
              hasOpenCapacity(snapshot) &&
              !violatesFairnessGuardrail(snapshot.user.uid, index, ranked.length),
          ) ?? null
        : null;
    const next =
      overrideCandidate ??
      ranked.find((snapshot) => !violatesFairnessGuardrail(snapshot.user.uid, index, ranked.length)) ??
      ranked[0];
    if (!next) {
      assignments.set(leadKey, null);
      return;
    }

    assignments.set(leadKey, next.user.uid);
    next.assignedToday += 1;
    next.openLeadCount += 1;
    runAssignedByUid.set(next.user.uid, (runAssignedByUid.get(next.user.uid) ?? 0) + 1);
  });

  return assignments;
}

export function getLeadAutomationOwnerUid(lead: Pick<LeadDoc, "assignedTo" | "ownerUid">) {
  return lead.assignedTo ?? lead.ownerUid ?? null;
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatAutomationDateTime(date: Date | null | undefined) {
  if (!date) return null;
  return [
    date.getFullYear(),
    "-",
    padDatePart(date.getMonth() + 1),
    "-",
    padDatePart(date.getDate()),
    " ",
    padDatePart(date.getHours()),
    ":",
    padDatePart(date.getMinutes()),
  ].join("");
}

function parseDateKey(dateKey: string | null | undefined) {
  if (!dateKey) return null;
  const parsed = new Date(`${dateKey}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function coerceAutomationDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "object") {
    const candidate = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
      _seconds?: number;
      _nanoseconds?: number;
    };

    if (typeof candidate.toDate === "function") {
      const parsed = candidate.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const seconds = typeof candidate.seconds === "number"
      ? candidate.seconds
      : typeof candidate._seconds === "number"
        ? candidate._seconds
        : null;
    if (seconds != null) {
      const millis = seconds * 1000;
      const parsed = new Date(millis);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
}

function buildLeadTaskContextLines(input: {
  lead: Pick<
    LeadWorkflowSnapshot,
    "leadId" | "name" | "targetDegree" | "targetUniversity" | "subStatus" | "enrollmentDetails"
  >;
  stage?: string | null;
  reason?: string | null;
  remarks?: string | null;
  deadline?: Date | null;
  extraLines?: Array<string | null>;
}) {
  return [
    `Lead: ${input.lead.name}`,
    `Lead ID: ${input.lead.leadId}`,
    input.lead.targetDegree ? `Program: ${input.lead.targetDegree}` : null,
    input.lead.targetUniversity ? `University: ${input.lead.targetUniversity}` : null,
    input.lead.subStatus ? `Sub Status: ${input.lead.subStatus}` : null,
    input.stage ? `Stage: ${input.stage}` : null,
    input.reason ? `Reason: ${input.reason}` : null,
    input.deadline ? `Due: ${formatAutomationDateTime(input.deadline)}` : null,
    input.lead.enrollmentDetails?.fee != null ? `Fee: ${input.lead.enrollmentDetails.fee}` : null,
    input.lead.enrollmentDetails?.paymentMode
      ? `Payment Mode: ${input.lead.enrollmentDetails.paymentMode}`
      : null,
    input.remarks?.trim() ? `Notes: ${input.remarks.trim()}` : null,
    ...(input.extraLines ?? []).filter(Boolean),
  ].filter(Boolean);
}

export function shouldCreateAutomatedFollowUpTask(
  status: string | null | undefined,
  followUpDate: Date | null,
) {
  const normalized = normalizeLeadStatus(status);
  return Boolean(followUpDate) && (normalized === "followup" || normalized === PAYMENT_FOLLOW_UP_STATUS);
}

export function buildAutomatedFollowUpTaskTitle(
  lead: Pick<LeadDoc, "name">,
  status: string | null | undefined,
) {
  return isPaymentFollowUpStatus(status)
    ? `Payment follow up with ${lead.name}`
    : `Follow up with ${lead.name}`;
}

export function buildAutomatedFollowUpTaskDescription(input: {
  lead: Pick<LeadDoc, "leadId" | "name" | "targetDegree" | "targetUniversity">;
  status: string | null | undefined;
  remarks?: string | null;
  stage?: string | null;
  reason?: string | null;
  followUpDate?: Date | null;
}) {
  return buildLeadTaskContextLines({
    lead: {
      ...input.lead,
      subStatus: null,
      enrollmentDetails: null,
    },
    stage: input.stage,
    reason: input.reason,
    remarks: input.remarks,
    deadline: input.followUpDate ?? null,
  }).join("\n");
}

export function isLeadEligibleForAutomation(status: string | null | undefined) {
  const normalized = normalizeLeadStatus(status);
  return !isClosedLeadStatus(normalized) && normalized !== "not_interested" && normalized !== "wrong_number";
}

export function getLeadAutomationFollowUpDate(lead: Pick<LeadDoc, "nextFollowUp">) {
  return coerceAutomationDate(lead.nextFollowUp);
}

export function getLeadLastTouchAt(
  lead: Pick<
    LeadDoc,
    "lastActivityAt" | "lastActionAt" | "updatedAt" | "createdAt" | "lastContactDateKey"
  >,
) {
  return (
    coerceAutomationDate(lead.lastActivityAt) ??
    coerceAutomationDate(lead.lastActionAt) ??
    parseDateKey(lead.lastContactDateKey ?? null) ??
    coerceAutomationDate(lead.updatedAt) ??
    coerceAutomationDate(lead.createdAt)
  );
}

export function isLeadStale(
  lead: Pick<
    LeadDoc,
    "status" | "lastActivityAt" | "lastActionAt" | "updatedAt" | "createdAt" | "lastContactDateKey"
  >,
  input?: {
    now?: Date;
    staleLeadHours?: number;
  },
) {
  if (!isLeadEligibleForAutomation(lead.status)) return false;

  const lastTouchAt = getLeadLastTouchAt(lead);
  if (!lastTouchAt) return true;

  const now = input?.now ?? new Date();
  const staleLeadHours = input?.staleLeadHours ?? DEFAULT_CRM_STALE_LEAD_HOURS;
  const elapsedHours = (now.getTime() - lastTouchAt.getTime()) / (1000 * 60 * 60);
  return elapsedHours >= staleLeadHours;
}

export function getLeadSlaBucket(lead: LeadDoc, todayKey: string): LeadSlaBucket {
  if (!getLeadAutomationOwnerUid(lead)) return "none";
  if (!isLeadEligibleForAutomation(lead.status)) return "none";
  if (!lead.nextFollowUpDateKey) return "none";

  if (lead.nextFollowUpDateKey < todayKey) return "overdue";
  if (lead.nextFollowUpDateKey === todayKey) return "due_today";
  return "none";
}

export function getLeadOverdueDays(
  lead: Pick<LeadDoc, "nextFollowUpDateKey">,
  todayKey: string,
) {
  if (!lead.nextFollowUpDateKey || lead.nextFollowUpDateKey >= todayKey) return 0;

  const dueAt = parseDateKey(lead.nextFollowUpDateKey);
  const todayAt = parseDateKey(todayKey);
  if (!dueAt || !todayAt) return 0;

  return Math.max(0, Math.floor((todayAt.getTime() - dueAt.getTime()) / (1000 * 60 * 60 * 24)));
}

export function isCrmWorkflowTaskType(value: string | null | undefined): value is CrmWorkflowTaskType {
  return CRM_WORKFLOW_TASK_TYPES.includes(value as CrmWorkflowTaskType);
}

export function getCrmWorkflowTaskType(task: {
  automationType?: string | null;
  isSystemGenerated?: boolean | null;
  category?: string | null;
}): CrmWorkflowTaskType | null {
  if (isCrmWorkflowTaskType(task.automationType ?? null)) {
    return task.automationType as CrmWorkflowTaskType;
  }

  if (task.isSystemGenerated && task.category === "Automated Follow Up") {
    return "lead_follow_up";
  }

  return null;
}

export function getCrmWorkflowTaskId(type: CrmWorkflowTaskType, leadId: string) {
  const safeLeadId = leadId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `crm-${type}-${safeLeadId}`;
}

function buildPaymentReviewTask(input: LeadWorkflowContextInput) {
  const assigneeUid = getLeadAutomationOwnerUid(input.lead);
  if (!assigneeUid) return null;
  if (normalizeLeadStatus(input.status ?? input.lead.status) !== PAYMENT_FOLLOW_UP_STATUS) return null;
  if (input.followUpDate ?? getLeadAutomationFollowUpDate(input.lead)) return null;

  return {
    type: "lead_payment_review",
    assigneeUid,
    title: `Review payment stage for ${input.lead.name}`,
    description: buildLeadTaskContextLines({
      lead: input.lead,
      stage: input.stage,
      reason: input.reason,
      remarks: input.remarks,
      deadline: input.now ?? new Date(),
      extraLines: [
        "Action: confirm payment status, documents, and next collection step.",
      ],
    }).join("\n"),
    category: "Automated Payment Review",
    priority: "high",
    deadline: input.now ?? new Date(),
    source: input.source ?? "crm_status_automation",
  } satisfies CrmWorkflowTaskDefinition;
}

function buildReactivationTask(input: LeadWorkflowContextInput) {
  const assigneeUid = getLeadAutomationOwnerUid(input.lead);
  if (!assigneeUid) return null;

  const effectiveStatus = input.status ?? input.lead.status;
  if (!isLeadEligibleForAutomation(effectiveStatus)) return null;
  if (isPaymentFollowUpStatus(effectiveStatus)) return null;
  if (getLeadSlaBucket(input.lead as LeadDoc, (input.now ?? new Date()).toISOString().slice(0, 10)) !== "none") {
    return null;
  }
  if (!isLeadStale(input.lead, { now: input.now, staleLeadHours: input.staleLeadHours })) return null;

  return {
    type: "lead_reactivation",
    assigneeUid,
    title: `Re-engage ${input.lead.name}`,
    description: buildLeadTaskContextLines({
      lead: input.lead,
      stage: input.stage,
      reason: input.reason,
      remarks: input.remarks,
      deadline: input.now ?? new Date(),
      extraLines: [
        `Action: no activity for ${input.staleLeadHours ?? DEFAULT_CRM_STALE_LEAD_HOURS}+ hours. Reconnect and set the next step.`,
      ],
    }).join("\n"),
    category: "Automated Reactivation",
    priority: "medium",
    deadline: input.now ?? new Date(),
    source: input.source ?? "crm_cron_automation",
  } satisfies CrmWorkflowTaskDefinition;
}

function buildSlaRecoveryTask(input: LeadWorkflowContextInput) {
  const assigneeUid = getLeadAutomationOwnerUid(input.lead);
  if (!assigneeUid) return null;

  const todayKey = (input.now ?? new Date()).toISOString().slice(0, 10);
  if (getLeadSlaBucket(input.lead as LeadDoc, todayKey) !== "overdue") return null;

  const followUpDate = input.followUpDate ?? getLeadAutomationFollowUpDate(input.lead);
  return {
    type: "lead_sla_recovery",
    assigneeUid,
    title: `Recover overdue lead ${input.lead.name}`,
    description: buildLeadTaskContextLines({
      lead: input.lead,
      stage: input.stage,
      reason: input.reason,
      remarks: input.remarks,
      deadline: followUpDate ?? (input.now ?? new Date()),
      extraLines: [
        `Action: follow-up SLA is overdue by ${getLeadOverdueDays(input.lead, todayKey)} day(s). Contact the lead and reset the next follow-up.`,
      ],
    }).join("\n"),
    category: "Automated SLA Recovery",
    priority: "high",
    deadline: followUpDate ?? (input.now ?? new Date()),
    source: input.source ?? "crm_cron_automation",
  } satisfies CrmWorkflowTaskDefinition;
}

function buildManagerEscalationTask(input: LeadWorkflowContextInput) {
  if (!input.supervisorUid) return null;

  const todayKey = (input.now ?? new Date()).toISOString().slice(0, 10);
  const overdueDays = getLeadOverdueDays(input.lead, todayKey);
  if (overdueDays < (input.overdueEscalationDays ?? DEFAULT_CRM_OVERDUE_ESCALATION_DAYS)) {
    return null;
  }

  return {
    type: "lead_manager_escalation",
    assigneeUid: input.supervisorUid,
    title: `Manager review for overdue lead ${input.lead.name}`,
    description: buildLeadTaskContextLines({
      lead: input.lead,
      stage: input.stage,
      reason: input.reason,
      remarks: input.remarks,
      deadline: input.now ?? new Date(),
      extraLines: [
        `Action: this lead has been overdue for ${overdueDays} day(s). Review owner follow-up and intervene if needed.`,
      ],
    }).join("\n"),
    category: "Automated Manager Escalation",
    priority: "high",
    deadline: input.now ?? new Date(),
    source: input.source ?? "crm_cron_automation",
  } satisfies CrmWorkflowTaskDefinition;
}

export function buildLeadWorkflowTaskDefinitions(input: LeadWorkflowContextInput) {
  const effectiveStatus = input.status ?? input.lead.status;
  const followUpDate = input.followUpDate ?? getLeadAutomationFollowUpDate(input.lead);
  const assigneeUid = getLeadAutomationOwnerUid(input.lead);

  if (!assigneeUid) return [] satisfies CrmWorkflowTaskDefinition[];

  const definitions: CrmWorkflowTaskDefinition[] = [];

  if (shouldCreateAutomatedFollowUpTask(effectiveStatus, followUpDate)) {
    definitions.push({
      type: "lead_follow_up",
      assigneeUid,
      title: buildAutomatedFollowUpTaskTitle(input.lead, effectiveStatus),
      description: buildAutomatedFollowUpTaskDescription({
        lead: input.lead,
        status: effectiveStatus,
        remarks: input.remarks,
        stage: input.stage,
        reason: input.reason,
        followUpDate,
      }),
      category: "Automated Follow Up",
      priority: isPaymentFollowUpStatus(effectiveStatus) ? "high" : "medium",
      deadline: followUpDate,
      source: input.source ?? "crm_status_automation",
    });
  }

  const paymentReviewTask = buildPaymentReviewTask({
    ...input,
    status: effectiveStatus,
    followUpDate,
  });
  if (paymentReviewTask) definitions.push(paymentReviewTask);

  const slaRecoveryTask = buildSlaRecoveryTask({
    ...input,
    status: effectiveStatus,
    followUpDate,
  });
  if (slaRecoveryTask) definitions.push(slaRecoveryTask);

  const reactivationTask = buildReactivationTask({
    ...input,
    status: effectiveStatus,
    followUpDate,
  });
  if (reactivationTask) definitions.push(reactivationTask);

  const managerEscalationTask = buildManagerEscalationTask({
    ...input,
    status: effectiveStatus,
    followUpDate,
  });
  if (managerEscalationTask) definitions.push(managerEscalationTask);

  return definitions;
}
