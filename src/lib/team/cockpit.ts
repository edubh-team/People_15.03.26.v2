import { isLeadStale24h, parseDateValue } from "@/lib/crm/workbench";
import {
  getTaskAssignee,
  type TaskLeadIntegrityState,
} from "@/lib/tasks/model";
import {
  isTaskCompleted,
  normalizeWorkbenchTask,
  type TaskDoc,
} from "@/lib/tasks/workbench";
import type { LeadDoc } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";
import { isClosedLeadStatus, normalizeLeadStatus } from "@/lib/leads/status";
import { isRevenueLead } from "@/lib/utils/leadLogic";

export type CockpitRepStatus = "available" | "balanced" | "overloaded";

export type CockpitTaskDoc = TaskDoc & {
  leadIntegrityState?: TaskLeadIntegrityState;
};

export type CockpitLeadQueueEntry = {
  lead: LeadDoc;
  owner: UserDoc | null;
  ageHours: number;
  label: string;
  actionLabel: string;
  statusTone: "critical" | "warning" | "success";
};

export type CockpitRepWorkload = {
  user: UserDoc;
  activeLeads: number;
  staleLeads: number;
  overdueFollowUps: number;
  dueToday: number;
  closuresToday: number;
  openTasks: number;
  loadRatio: number | null;
  capacity: number | null;
  status: CockpitRepStatus;
  score: number;
};

export type ManagerCockpitData = {
  summary: {
    scopedReps: number;
    staleLeads: number;
    overdueFollowUps: number;
    closuresToday: number;
    overloadedReps: number;
    openTasks: number;
  };
  workloads: CockpitRepWorkload[];
  staleLeads: CockpitLeadQueueEntry[];
  overdueFollowUps: CockpitLeadQueueEntry[];
  closuresToday: CockpitLeadQueueEntry[];
  recommendedShift:
    | {
        from: CockpitRepWorkload;
        to: CockpitRepWorkload;
      }
    | null;
};

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function diffHours(from: Date | null, to = new Date()) {
  if (!from) return 0;
  return Math.max(0, Math.round(((to.getTime() - from.getTime()) / 36e5) * 10) / 10);
}

function getLeadLastTouch(lead: LeadDoc) {
  return (
    parseDateValue(lead.lastActivityAt) ??
    (lead.lastContactDateKey
      ? parseDateValue(`${lead.lastContactDateKey}T00:00:00`)
      : null) ??
    parseDateValue(lead.lastActionAt) ??
    parseDateValue(lead.updatedAt) ??
    parseDateValue(lead.createdAt)
  );
}

function getLeadFollowUpDate(lead: LeadDoc) {
  return (
    parseDateValue(lead.nextFollowUp) ??
    (lead.nextFollowUpDateKey
      ? parseDateValue(`${lead.nextFollowUpDateKey}T09:00:00`)
      : null)
  );
}

function getLeadClosureDate(lead: LeadDoc) {
  return (
    parseDateValue(lead.enrollmentDetails?.closedAt) ??
    parseDateValue(lead.closedAt) ??
    parseDateValue(lead.updatedAt) ??
    parseDateValue(lead.createdAt)
  );
}

export function isLeadOverdueFollowUp(lead: LeadDoc, now = new Date()) {
  if (isRevenueLead(lead) || isClosedLeadStatus(lead.status)) return false;
  if (!lead.nextFollowUpDateKey) return false;
  return lead.nextFollowUpDateKey < toDateKey(now);
}

export function isLeadClosedToday(lead: LeadDoc, now = new Date()) {
  if (!isRevenueLead(lead) && !isClosedLeadStatus(lead.status)) return false;
  const closureDate = getLeadClosureDate(lead);
  return Boolean(
    closureDate &&
      startOfDay(closureDate).getTime() === startOfDay(now).getTime(),
  );
}

function getRepCapacity(user: UserDoc) {
  if (typeof user.crmMaxOpenLeads === "number" && user.crmMaxOpenLeads > 0) {
    return user.crmMaxOpenLeads;
  }

  if (
    typeof user.crmDailyLeadCapacity === "number" &&
    user.crmDailyLeadCapacity > 0
  ) {
    return Math.max(user.crmDailyLeadCapacity * 3, user.crmDailyLeadCapacity);
  }

  return null;
}

function sortByDisplayName(users: UserDoc[]) {
  return [...users].sort((left, right) => {
    const leftLabel = left.displayName ?? left.name ?? left.email ?? left.uid;
    const rightLabel = right.displayName ?? right.name ?? right.email ?? right.uid;
    return leftLabel.localeCompare(rightLabel);
  });
}

function buildQueueEntry(
  lead: LeadDoc,
  owner: UserDoc | null,
  now: Date,
  mode: "stale" | "overdue" | "closure",
): CockpitLeadQueueEntry {
  if (mode === "closure") {
    const closedAt = getLeadClosureDate(lead);
    const ageHours = diffHours(closedAt, now);
    return {
      lead,
      owner,
      ageHours,
      label: closedAt
        ? `Closed ${closedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : "Closed today",
      actionLabel: "Review closure",
      statusTone: "success",
    };
  }

  if (mode === "overdue") {
    const followUpDate = getLeadFollowUpDate(lead);
    const ageHours = diffHours(followUpDate, now);
    return {
      lead,
      owner,
      ageHours,
      label: followUpDate
        ? `Follow-up missed by ${Math.max(1, Math.round(ageHours))}h`
        : "Follow-up overdue",
      actionLabel: "Reassign or chase",
      statusTone: ageHours >= 48 ? "critical" : "warning",
    };
  }

  const lastTouch = getLeadLastTouch(lead);
  const ageHours = diffHours(lastTouch, now);
  return {
    lead,
    owner,
    ageHours,
    label: lastTouch
      ? `No activity for ${Math.max(24, Math.round(ageHours))}h`
      : "No recent activity",
    actionLabel: "Re-engage now",
    statusTone: ageHours >= 48 ? "critical" : "warning",
  };
}

type RawTaskDoc = Record<string, unknown> & {
  id?: string;
};

export function normalizeCockpitTask(
  task: RawTaskDoc,
  fallbackId?: string,
): CockpitTaskDoc {
  return normalizeWorkbenchTask(task, fallbackId) as CockpitTaskDoc;
}

export function buildManagerCockpit(input: {
  users: UserDoc[];
  leads: LeadDoc[];
  tasks: CockpitTaskDoc[];
  now?: Date;
}): ManagerCockpitData {
  const now = input.now ?? new Date();
  const sortedUsers = sortByDisplayName(input.users);
  const owners = new Map(sortedUsers.map((user) => [user.uid, user] as const));
  const leadOwnerUid = (lead: LeadDoc) => lead.assignedTo ?? lead.ownerUid ?? null;

  const staleLeads = input.leads
    .filter((lead) => isLeadStale24h(lead, now))
    .sort(
      (left, right) =>
        (getLeadLastTouch(left)?.getTime() ?? 0) -
        (getLeadLastTouch(right)?.getTime() ?? 0),
    );

  const overdueFollowUps = input.leads
    .filter((lead) => isLeadOverdueFollowUp(lead, now))
    .sort(
      (left, right) =>
        (getLeadFollowUpDate(left)?.getTime() ?? 0) -
        (getLeadFollowUpDate(right)?.getTime() ?? 0),
    );

  const closuresToday = input.leads
    .filter((lead) => isLeadClosedToday(lead, now))
    .sort(
      (left, right) =>
        (getLeadClosureDate(right)?.getTime() ?? 0) -
        (getLeadClosureDate(left)?.getTime() ?? 0),
    );

  const openTasks = input.tasks.filter((task) => !isTaskCompleted(task));

  const workloads = sortedUsers
    .map((user) => {
      const activeLeads = input.leads.filter((lead) => {
        const ownerUid = leadOwnerUid(lead);
        if (ownerUid !== user.uid) return false;
        return !isRevenueLead(lead) && !isClosedLeadStatus(lead.status);
      }).length;

      const staleCount = staleLeads.filter(
        (lead) => leadOwnerUid(lead) === user.uid,
      ).length;
      const overdueCount = overdueFollowUps.filter(
        (lead) => leadOwnerUid(lead) === user.uid,
      ).length;
      const dueToday = input.leads.filter((lead) => {
        if (leadOwnerUid(lead) !== user.uid) return false;
        if (isRevenueLead(lead) || isClosedLeadStatus(lead.status)) return false;
        return lead.nextFollowUpDateKey === toDateKey(now);
      }).length;
      const closureCount = closuresToday.filter(
        (lead) => leadOwnerUid(lead) === user.uid,
      ).length;
      const taskCount = openTasks.filter(
        (task) => getTaskAssignee(task) === user.uid,
      ).length;
      const capacity = getRepCapacity(user);
      const loadRatio =
        capacity && capacity > 0
          ? Number((activeLeads / capacity).toFixed(2))
          : null;

      const score =
        staleCount * 2 +
        overdueCount * 3 +
        taskCount * 0.4 +
        activeLeads * 0.15 -
        closureCount * 0.5 +
        (loadRatio && loadRatio > 1 ? (loadRatio - 1) * 10 : 0);

      let status: CockpitRepStatus = "balanced";
      if (
        (loadRatio !== null && loadRatio >= 1) ||
        overdueCount >= 4 ||
        staleCount >= 6 ||
        taskCount >= 12
      ) {
        status = "overloaded";
      } else if (
        (loadRatio !== null && loadRatio <= 0.55) &&
        overdueCount === 0 &&
        staleCount <= 1 &&
        taskCount <= 4
      ) {
        status = "available";
      }

      return {
        user,
        activeLeads,
        staleLeads: staleCount,
        overdueFollowUps: overdueCount,
        dueToday,
        closuresToday: closureCount,
        openTasks: taskCount,
        loadRatio,
        capacity,
        status,
        score,
      } satisfies CockpitRepWorkload;
    })
    .sort((left, right) => right.score - left.score);

  const overloaded = workloads.filter((rep) => rep.status === "overloaded");
  const available = [...workloads]
    .filter((rep) => rep.status === "available")
    .sort((left, right) => left.score - right.score);

  const recommendedShift =
    overloaded.length > 0 && available.length > 0
      ? {
          from: overloaded[0],
          to: available[0],
        }
      : null;

  return {
    summary: {
      scopedReps: sortedUsers.length,
      staleLeads: staleLeads.length,
      overdueFollowUps: overdueFollowUps.length,
      closuresToday: closuresToday.length,
      overloadedReps: overloaded.length,
      openTasks: openTasks.length,
    },
    workloads,
    staleLeads: staleLeads.map((lead) =>
      buildQueueEntry(lead, owners.get(leadOwnerUid(lead) ?? "") ?? null, now, "stale"),
    ),
    overdueFollowUps: overdueFollowUps.map((lead) =>
      buildQueueEntry(lead, owners.get(leadOwnerUid(lead) ?? "") ?? null, now, "overdue"),
    ),
    closuresToday: closuresToday.map((lead) =>
      buildQueueEntry(lead, owners.get(leadOwnerUid(lead) ?? "") ?? null, now, "closure"),
    ),
    recommendedShift,
  };
}

export function getLeadStageLabel(lead: LeadDoc) {
  const currentStage = lead.statusDetail?.currentStage?.trim();
  const currentReason = lead.statusDetail?.currentReason?.trim();
  if (currentStage && currentReason) return `${currentStage} | ${currentReason}`;
  if (currentStage) return currentStage;
  if (currentReason) return currentReason;
  return normalizeLeadStatus(lead.status).replace(/_/g, " ");
}
