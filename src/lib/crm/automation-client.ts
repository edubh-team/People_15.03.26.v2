import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import {
  CRM_WORKFLOW_TASK_TYPES,
  buildLeadWorkflowTaskDefinitions,
  buildCrmRoutingAssignments,
  canReceiveAutoAssignedLeads,
  getCrmDailyCapacity,
  getCrmMaxOpenLeads,
  getCrmWorkflowTaskId,
  getCrmWorkflowTaskType,
  getCrmRoutingCandidatesForOwner,
  isLeadEligibleForAutomation,
  getLeadSlaBucket,
  isLeadStale,
  isUserAvailableForRouting,
  type CrmWorkflowTaskDefinition,
  type CrmWorkflowTaskType,
  type CrmRoutingCandidateSnapshot,
} from "@/lib/crm/automation";
import { buildTaskLeadWriteFields, normalizeTaskDoc, buildTaskWriteFields } from "@/lib/tasks/model";
import type { LeadTimelineActor, LeadDoc } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";
import { getAllActiveUsers, getUserDoc } from "@/lib/firebase/users";

type PresenceDoc = {
  uid: string;
  status?: string | null;
  dateKey?: string | null;
};

type AutomationTaskDoc = ReturnType<typeof normalizeTaskDoc<Record<string, unknown>>> & {
  status?: string;
  automationType?: string;
  isSystemGenerated?: boolean;
  category?: string;
};

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isCrmAutomationTask(task: AutomationTaskDoc) {
  return Boolean(getCrmWorkflowTaskType(task));
}

function getAutomationTaskStatus(task: AutomationTaskDoc | undefined) {
  return task?.status === "in_progress" ? "in_progress" : "pending";
}

function buildAutomationNotificationCopy(
  definition: CrmWorkflowTaskDefinition,
  actorName: string | null | undefined,
  leadName: string,
) {
  const sender = actorName ?? "CRM";

  switch (definition.type) {
    case "lead_payment_review":
      return {
        title: "Payment-stage action task",
        body: `${sender} queued a payment-stage action for ${leadName}.`,
      };
    case "lead_reactivation":
      return {
        title: "Lead reactivation task",
        body: `${sender} queued a reactivation task for ${leadName}.`,
      };
    case "lead_sla_recovery":
      return {
        title: "Overdue lead recovery task",
        body: `${sender} queued an overdue lead recovery task for ${leadName}.`,
      };
    case "lead_manager_escalation":
      return {
        title: "Manager review task",
        body: `${sender} escalated ${leadName} for manager review.`,
      };
    case "lead_follow_up":
    default:
      return {
        title: "Automated follow-up task",
        body: `${sender} scheduled "${definition.title}" for ${leadName}.`,
      };
  }
}

function groupAutomationTasksByType(tasks: AutomationTaskDoc[]) {
  const grouped = new Map<CrmWorkflowTaskType, AutomationTaskDoc[]>();

  tasks.forEach((task) => {
    const type = getCrmWorkflowTaskType(task);
    if (!type) return;

    const bucket = grouped.get(type) ?? [];
    bucket.push(task);
    grouped.set(type, bucket);
  });

  return grouped;
}

function getActiveAutomationTask(tasks: AutomationTaskDoc[]) {
  return tasks.find((task) => task.status !== "completed");
}

function buildWorkflowTaskWrite(input: {
  definition: CrmWorkflowTaskDefinition;
  lead: LeadDoc;
  actor: LeadTimelineActor;
  existingTask?: AutomationTaskDoc;
}) {
  return {
    id: input.existingTask?.id ?? getCrmWorkflowTaskId(input.definition.type, input.lead.leadId),
    title: input.definition.title,
    description: input.definition.description,
    ...buildTaskWriteFields({
      assigneeUid: input.definition.assigneeUid,
      creatorUid: input.actor.uid,
    }),
    status: getAutomationTaskStatus(input.existingTask),
    priority: input.definition.priority,
    category: input.definition.category,
    deadline: input.definition.deadline ? Timestamp.fromDate(input.definition.deadline) : null,
    updatedAt: serverTimestamp(),
    completedAt: null,
    attachments: [],
    ...buildTaskLeadWriteFields({
      lead: {
        ...input.lead,
        status: input.lead.status,
      },
    }),
    automationType: input.definition.type,
    isSystemGenerated: true,
    automationSource: input.definition.source,
    ...(input.existingTask ? {} : { createdAt: serverTimestamp() }),
  };
}

async function getPresenceByUid(uids: string[]) {
  if (!db) throw new Error("Firebase is not configured");
  const firestore = db;

  const snapshots = await Promise.all(
    uids.map(async (uid) => {
      const snap = await getDoc(doc(firestore, "presence", uid));
      return [uid, snap.exists() ? (snap.data() as PresenceDoc) : null] as const;
    }),
  );

  return new Map<string, PresenceDoc | null>(snapshots);
}

async function getAssignedTodayCounts(uids: string[], todayKey: string) {
  if (!db) throw new Error("Firebase is not configured");
  const firestore = db;

  const snapshots = await Promise.all(
    uids.map(async (uid) => {
      const snap = await getDocs(
        query(
          collection(firestore, "leads"),
          where("ownerUid", "==", uid),
          where("createdDateKey", "==", todayKey),
          limit(1000),
        ),
      );
      return [uid, snap.size] as const;
    }),
  );

  return new Map<string, number>(snapshots);
}

async function getOpenLeadCounts(uids: string[], todayKey: string) {
  if (!db) throw new Error("Firebase is not configured");
  const firestore = db;

  const snapshots = await Promise.all(
    uids.map(async (uid) => {
      const snap = await getDocs(
        query(collection(firestore, "leads"), where("ownerUid", "==", uid), limit(1000)),
      );
      const next = snap.docs.reduce(
        (total, row) => {
        const lead = row.data() as LeadDoc;
          if (!isLeadEligibleForAutomation(lead.status)) return total;
          total.openLeadCount += 1;
          if (isLeadStale(lead, { now: new Date() })) total.staleLeadCount += 1;
          if (getLeadSlaBucket(lead, todayKey) === "overdue") total.overdueFollowUpCount += 1;
          return total;
        },
        { openLeadCount: 0, staleLeadCount: 0, overdueFollowUpCount: 0 },
      );
      return [uid, next] as const;
    }),
  );

  return new Map<string, { openLeadCount: number; staleLeadCount: number; overdueFollowUpCount: number }>(snapshots);
}

async function loadRoutingSnapshots(ownerUid: string, todayKey = getTodayKey()) {
  const owner = await getUserDoc(ownerUid);
  if (!owner || !canReceiveAutoAssignedLeads(owner) && getCrmRoutingCandidatesForOwner(owner, []).length === 0) {
    const users = await getAllActiveUsers();
    if (!owner) return [];
    const candidates = getCrmRoutingCandidatesForOwner(owner, users);
    if (candidates.length === 0) return [];
  }

  const users = await getAllActiveUsers();
  if (!owner) return [];
  const candidates = getCrmRoutingCandidatesForOwner(owner, users);
  if (candidates.length === 0) return [];

  const candidateIds = candidates.map((candidate) => candidate.uid);
  const [presenceByUid, assignedTodayByUid, openLeadByUid] = await Promise.all([
    getPresenceByUid(candidateIds),
    getAssignedTodayCounts(candidateIds, todayKey),
    getOpenLeadCounts(candidateIds, todayKey),
  ]);

  return candidates.map((user) => ({
    user,
    presence: presenceByUid.get(user.uid) ?? null,
    assignedToday: assignedTodayByUid.get(user.uid) ?? 0,
    openLeadCount: openLeadByUid.get(user.uid)?.openLeadCount ?? 0,
    staleLeadCount: openLeadByUid.get(user.uid)?.staleLeadCount ?? 0,
    overdueFollowUpCount: openLeadByUid.get(user.uid)?.overdueFollowUpCount ?? 0,
    dailyCapacity: getCrmDailyCapacity(user),
    maxOpenLeads: getCrmMaxOpenLeads(user),
  } satisfies CrmRoutingCandidateSnapshot));
}

export async function getBulkCrmRoutingAssignments(
  ownerUid: string,
  leadKeys: string[],
  options?: {
    overrideAssigneeUid?: string | null;
  },
) {
  const todayKey = getTodayKey();
  const snapshots = await loadRoutingSnapshots(ownerUid, todayKey);
  if (snapshots.length === 0) {
    return new Map<string, string | null>(leadKeys.map((leadKey) => [leadKey, null] as const));
  }

  return buildCrmRoutingAssignments(snapshots, leadKeys, todayKey, {
    overrideAssigneeUid: options?.overrideAssigneeUid ?? null,
  });
}

export async function getCrmRoutingSuggestion(ownerUid: string) {
  const todayKey = getTodayKey();
  const snapshots = await loadRoutingSnapshots(ownerUid, todayKey);
  const available = snapshots.filter((snapshot) => isUserAvailableForRouting(snapshot.presence, todayKey));
  const ranked = buildCrmRoutingAssignments(available.length > 0 ? available : snapshots, ["preview"], todayKey);
  return ranked.get("preview") ?? null;
}

export async function createAutoAssignmentNotifications(input: {
  assignments: Map<string, string | null>;
  actor: LeadTimelineActor;
  sourceLabel: string;
}) {
  if (!db) throw new Error("Firebase is not configured");
  const firestore = db;

  const countsByAssignee = new Map<string, number>();
  input.assignments.forEach((uid) => {
    if (!uid) return;
    countsByAssignee.set(uid, (countsByAssignee.get(uid) ?? 0) + 1);
  });

  if (countsByAssignee.size === 0) return;

  const batch = writeBatch(firestore);
  countsByAssignee.forEach((count, uid) => {
    const notificationRef = doc(collection(firestore, "notifications"));
    batch.set(notificationRef, {
      recipientUid: uid,
      title: "New auto-routed leads",
      body: `${input.actor.name ?? "CRM"} routed ${count} ${input.sourceLabel} lead${count === 1 ? "" : "s"} to you.`,
      read: false,
      createdAt: serverTimestamp(),
      priority: "medium",
      source: "crm_automation",
    });
  });
  await batch.commit();
}

export async function syncLeadFollowUpAutomation(input: {
  lead: LeadDoc;
  actor: LeadTimelineActor;
  status: string;
  followUpDate: Date | null;
  remarks?: string | null;
  stage?: string | null;
  reason?: string | null;
  source?: CrmWorkflowTaskDefinition["source"];
}) {
  return syncLeadWorkflowAutomation(input);
}

export async function syncLeadWorkflowAutomation(input: {
  lead: LeadDoc;
  actor: LeadTimelineActor;
  status: string;
  followUpDate: Date | null;
  remarks?: string | null;
  stage?: string | null;
  reason?: string | null;
  source?: CrmWorkflowTaskDefinition["source"];
}) {
  if (!db) throw new Error("Firebase is not configured");

  const firestore = db;
  const taskSnapshot = await getDocs(
    query(collection(firestore, "tasks"), where("leadId", "==", input.lead.leadId), limit(50)),
  );
  const automationTasks = taskSnapshot.docs
    .map((row) => normalizeTaskDoc(row.data() as Record<string, unknown>, row.id) as AutomationTaskDoc)
    .filter(isCrmAutomationTask);

  const tasksByType = groupAutomationTasksByType(automationTasks);
  const desiredDefinitions = buildLeadWorkflowTaskDefinitions({
    lead: {
      ...input.lead,
      status: input.status as LeadDoc["status"],
      nextFollowUp: input.followUpDate ?? input.lead.nextFollowUp ?? null,
      nextFollowUpDateKey: input.followUpDate
        ? toDateKey(input.followUpDate)
        : input.lead.nextFollowUpDateKey ?? null,
    },
    status: input.status,
    followUpDate: input.followUpDate,
    remarks: input.remarks,
    stage: input.stage,
    reason: input.reason,
    source: input.source ?? "crm_status_automation",
  });

  const batch = writeBatch(firestore);

  desiredDefinitions.forEach((definition) => {
    const sameTypeTasks = tasksByType.get(definition.type) ?? [];
    const activeTask = getActiveAutomationTask(sameTypeTasks);
    const taskId = activeTask?.id ?? getCrmWorkflowTaskId(definition.type, input.lead.leadId);
    const taskRef = doc(firestore, "tasks", taskId);

    batch.set(
      taskRef,
      buildWorkflowTaskWrite({
        definition,
        lead: {
          ...input.lead,
          status: input.status as LeadDoc["status"],
        },
        actor: input.actor,
        existingTask: activeTask,
      }),
      { merge: true },
    );

    sameTypeTasks
      .filter((task) => task.id !== taskId && task.status !== "completed")
      .forEach((task) => {
        batch.set(
          doc(firestore, "tasks", task.id),
          {
            status: "completed",
            completedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });

    const assigneeChanged = activeTask?.assignedTo !== definition.assigneeUid;
    if ((!activeTask || assigneeChanged) && definition.assigneeUid !== input.actor.uid) {
      const notificationRef = doc(collection(firestore, "notifications"));
      const copy = buildAutomationNotificationCopy(definition, input.actor.name, input.lead.name);
      batch.set(notificationRef, {
        recipientUid: definition.assigneeUid,
        title: copy.title,
        body: copy.body,
        read: false,
        createdAt: serverTimestamp(),
        priority: definition.priority,
        relatedLeadId: input.lead.leadId,
        relatedTaskId: taskId,
        source: "crm_automation",
      });
    }
  });

  CRM_WORKFLOW_TASK_TYPES.forEach((type) => {
    if (desiredDefinitions.some((definition) => definition.type === type)) return;

    (tasksByType.get(type) ?? [])
      .filter((task) => task.status !== "completed")
      .forEach((task) => {
        batch.set(
          doc(firestore, "tasks", task.id),
          {
            status: "completed",
            completedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });
  });

  if (
    desiredDefinitions.length === 0 &&
    automationTasks.every((task) => task.status === "completed")
  ) {
    return;
  }

  await batch.commit();
}
