import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdmin } from "@/lib/firebase/admin";
import {
  DEFAULT_CRM_OVERDUE_ESCALATION_DAYS,
  DEFAULT_CRM_STALE_LEAD_HOURS,
  buildLeadWorkflowTaskDefinitions,
  getCrmWorkflowTaskId,
  getLeadSlaBucket,
  isLeadStale,
  type CrmWorkflowTaskType,
} from "@/lib/crm/automation";
import { buildTaskLeadWriteFields, buildTaskWriteFields } from "@/lib/tasks/model";
import { buildServerActor, writeServerAudit } from "@/lib/server/audit-log";
import {
  getEffectiveReportsToUid,
  getSalesHierarchyRank,
  normalizeSalesHierarchyRole,
} from "@/lib/sales/hierarchy";
import type { LeadDoc } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";

export const dynamic = "force-dynamic";

const CRON_WORKFLOW_TYPES = new Set<CrmWorkflowTaskType>([
  "lead_reactivation",
  "lead_sla_recovery",
  "lead_manager_escalation",
]);

function isCronAuthorized(request: Request) {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret) return true;

  const url = new URL(request.url);
  const headerSecret = request.headers.get("x-cron-secret")?.trim();
  const querySecret = url.searchParams.get("key")?.trim();

  return headerSecret === configuredSecret || querySecret === configuredSecret;
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getNumericEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeKeyPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function getUser(adminDb: Awaited<ReturnType<typeof getAdmin>>["adminDb"], uid: string) {
  const snapshot = await adminDb.collection("users").doc(uid).get();
  return snapshot.exists ? (snapshot.data() as UserDoc) : null;
}

async function getCachedUser(
  adminDb: Awaited<ReturnType<typeof getAdmin>>["adminDb"],
  cache: Map<string, UserDoc | null>,
  uid: string | null | undefined,
) {
  if (!uid) return null;
  if (cache.has(uid)) return cache.get(uid) ?? null;
  const row = await getUser(adminDb, uid);
  cache.set(uid, row);
  return row;
}

type EscalationRecipient = {
  uid: string;
  depth: number;
  role: ReturnType<typeof normalizeSalesHierarchyRole>;
};

const MANAGER_MIN_RANK = getSalesHierarchyRank("MANAGER");

function resolveFallbackReportsToUid(user: UserDoc | null | undefined) {
  if (!user) return null;
  return (
    getEffectiveReportsToUid(user) ??
    user.actingManagerId ??
    user.managerId ??
    user.teamLeadId ??
    null
  );
}

async function resolveEscalationChain(input: {
  adminDb: Awaited<ReturnType<typeof getAdmin>>["adminDb"];
  cache: Map<string, UserDoc | null>;
  ownerUid: string;
  ownerUser: UserDoc | null;
  maxDepth?: number;
}) {
  const chain: EscalationRecipient[] = [];
  const maxDepth = input.maxDepth ?? 6;
  const visited = new Set<string>([input.ownerUid]);
  let depth = 1;
  let cursorUid = resolveFallbackReportsToUid(input.ownerUser);

  while (cursorUid && depth <= maxDepth && !visited.has(cursorUid)) {
    visited.add(cursorUid);
    const supervisor = await getCachedUser(input.adminDb, input.cache, cursorUid);
    if (!supervisor) break;

    const rank = getSalesHierarchyRank(supervisor);
    const role = normalizeSalesHierarchyRole(supervisor.orgRole ?? supervisor.role ?? null);
    if (rank >= MANAGER_MIN_RANK) {
      chain.push({
        uid: supervisor.uid,
        depth,
        role,
      });
    }

    cursorUid = resolveFallbackReportsToUid(supervisor);
    depth += 1;
  }

  return chain;
}

async function getAutomationTaskSnapshot(
  adminDb: Awaited<ReturnType<typeof getAdmin>>["adminDb"],
  type: CrmWorkflowTaskType,
  leadId: string,
) {
  return adminDb.collection("tasks").doc(getCrmWorkflowTaskId(type, leadId)).get();
}

export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
    }

    const { adminDb } = await getAdmin();
    if (!adminDb) {
      return NextResponse.json({ error: "Firebase Admin not initialized" }, { status: 500 });
    }

    const todayKey = getTodayKey();
    const staleLeadHours = getNumericEnv("CRM_STALE_LEAD_HOURS", DEFAULT_CRM_STALE_LEAD_HOURS);
    const overdueEscalationDays = getNumericEnv(
      "CRM_OVERDUE_ESCALATION_DAYS",
      DEFAULT_CRM_OVERDUE_ESCALATION_DAYS,
    );
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - staleLeadHours * 60 * 60 * 1000);

    const [dueLeadsSnapshot, staleLeadsSnapshot] = await Promise.all([
      adminDb
        .collection("leads")
        .where("nextFollowUpDateKey", "<=", todayKey)
        .limit(500)
        .get(),
      adminDb
        .collection("leads")
        .where("updatedAt", "<=", staleCutoff)
        .limit(500)
        .get(),
    ]);

    const leadRows = new Map<string, LeadDoc>();
    dueLeadsSnapshot.docs.forEach((leadDoc) => {
      leadRows.set(leadDoc.id, { ...(leadDoc.data() as LeadDoc), leadId: leadDoc.id });
    });
    staleLeadsSnapshot.docs.forEach((leadDoc) => {
      leadRows.set(leadDoc.id, { ...(leadDoc.data() as LeadDoc), leadId: leadDoc.id });
    });

    if (leadRows.size === 0) {
      await writeServerAudit(adminDb, {
        action: "SYSTEM_CHANGE",
        details: "CRM automation cron ran with no actionable leads.",
        actor: buildServerActor({
          uid: "cron-crm-automation",
          displayName: "CRM Automation Cron",
          role: "SYSTEM",
          orgRole: "SYSTEM",
        }),
        metadata: {
          processed: 0,
          overdue: 0,
          dueToday: 0,
          stale: 0,
          notifications: 0,
          workflowTasks: 0,
          staleLeadHours,
          overdueEscalationDays,
        },
      });

      return NextResponse.json({
        success: true,
        processed: 0,
        overdue: 0,
        dueToday: 0,
        stale: 0,
        notifications: 0,
        workflowTasks: 0,
        dateKey: todayKey,
      });
    }

    const batch = adminDb.batch();
    const userCache = new Map<string, UserDoc | null>();
    let processed = 0;
    let overdue = 0;
    let dueToday = 0;
    let stale = 0;
    let notifications = 0;
    let workflowTasks = 0;
    let hasWrites = false;

    for (const lead of leadRows.values()) {
      const bucket = getLeadSlaBucket(lead, todayKey);
      const staleLead = isLeadStale(lead, { now, staleLeadHours });
      if (bucket === "none" && !staleLead) continue;

      const ownerUid = lead.assignedTo ?? lead.ownerUid ?? null;
      if (!ownerUid) continue;

      processed += 1;
      if (bucket === "overdue") overdue += 1;
      if (bucket === "due_today") dueToday += 1;
      if (staleLead) stale += 1;

      const ownerReminderKey =
        bucket === "none" ? null : sanitizeKeyPart(`crm-${bucket}-${todayKey}-${lead.leadId}-${ownerUid}`);
      if (ownerReminderKey) {
        batch.set(adminDb.collection("notifications").doc(ownerReminderKey), {
          recipientUid: ownerUid,
          title: bucket === "overdue" ? "Missed CRM follow-up SLA" : "CRM follow-up due today",
          body:
            bucket === "overdue"
              ? `${lead.name} is overdue for follow-up. Review the lead and update the next action now.`
              : `${lead.name} has a follow-up due today. Complete the touchpoint before the SLA slips.`,
          read: false,
          priority: bucket === "overdue" ? "high" : "medium",
          relatedLeadId: lead.leadId,
          source: "crm_automation",
          automationKey: ownerReminderKey,
          slaBucket: bucket,
          createdAt: FieldValue.serverTimestamp(),
        });
        notifications += 1;
        hasWrites = true;
      }

      const ownerUser = await getCachedUser(adminDb, userCache, ownerUid);
      const escalationChain = await resolveEscalationChain({
        adminDb,
        cache: userCache,
        ownerUid,
        ownerUser,
      });
      const supervisorUid = escalationChain[0]?.uid ?? null;

      if (staleLead) {
        const staleNotificationKey = sanitizeKeyPart(`crm-stale-${todayKey}-${lead.leadId}-${ownerUid}`);
        batch.set(adminDb.collection("notifications").doc(staleNotificationKey), {
          recipientUid: ownerUid,
          title: "CRM lead has no recent activity",
          body: `${lead.name} has had no CRM activity for ${staleLeadHours}+ hours. Reconnect and set the next step.`,
          read: false,
          priority: bucket === "overdue" ? "high" : "medium",
          relatedLeadId: lead.leadId,
          source: "crm_automation",
          automationKey: staleNotificationKey,
          createdAt: FieldValue.serverTimestamp(),
        });
        notifications += 1;
        hasWrites = true;
      }

      if (bucket === "overdue" && escalationChain.length > 0) {
        escalationChain.forEach((recipient) => {
          const escalationKey = sanitizeKeyPart(
            `crm-escalation-${todayKey}-${lead.leadId}-${recipient.uid}-${recipient.depth}`,
          );
          batch.set(adminDb.collection("notifications").doc(escalationKey), {
            recipientUid: recipient.uid,
            title: "Escalated CRM SLA miss",
            body: `${lead.name} is overdue and still assigned to ${ownerUser?.displayName ?? ownerUid}. Escalation level ${recipient.depth}.`,
            read: false,
            priority: "high",
            relatedLeadId: lead.leadId,
            source: "crm_automation",
            automationKey: escalationKey,
            escalationDepth: recipient.depth,
            escalationRole: recipient.role ?? null,
            slaBucket: bucket,
            createdAt: FieldValue.serverTimestamp(),
          });
          notifications += 1;
          hasWrites = true;
        });
      }

      const desiredTasks = buildLeadWorkflowTaskDefinitions({
        lead,
        now,
        staleLeadHours,
        overdueEscalationDays,
        supervisorUid,
        source: "crm_cron_automation",
      }).filter((definition) => CRON_WORKFLOW_TYPES.has(definition.type));

      const existingTaskSnapshots = await Promise.all(
        Array.from(CRON_WORKFLOW_TYPES).map(async (type) => [type, await getAutomationTaskSnapshot(adminDb, type, lead.leadId)] as const),
      );
      const existingTaskByType = new Map(existingTaskSnapshots);

      desiredTasks.forEach((definition) => {
        const taskId = getCrmWorkflowTaskId(definition.type, lead.leadId);
        const taskRef = adminDb.collection("tasks").doc(taskId);
        const existingTask = existingTaskByType.get(definition.type);
        const existingData = existingTask?.exists ? (existingTask.data() as Record<string, unknown>) : null;
        const previousAssignee =
          typeof existingData?.assignedTo === "string"
            ? existingData.assignedTo
            : typeof existingData?.assigneeUid === "string"
              ? existingData.assigneeUid
              : null;
        const wasActive = Boolean(existingTask?.exists) && existingData?.status !== "completed";

        batch.set(
          taskRef,
          {
            id: taskId,
            title: definition.title,
            description: definition.description,
            ...buildTaskWriteFields({
              assigneeUid: definition.assigneeUid,
              creatorUid: "cron-crm-automation",
            }),
            status: existingData?.status === "in_progress" ? "in_progress" : "pending",
            priority: definition.priority,
            category: definition.category,
            deadline: definition.deadline ?? null,
            updatedAt: FieldValue.serverTimestamp(),
            completedAt: null,
            attachments: [],
            ...buildTaskLeadWriteFields({ lead }),
            automationType: definition.type,
            isSystemGenerated: true,
            automationSource: definition.source,
            ...(existingTask?.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );
        workflowTasks += 1;
        hasWrites = true;

        if (!wasActive || previousAssignee !== definition.assigneeUid) {
          const taskNotificationKey = sanitizeKeyPart(
            `crm-task-${definition.type}-${todayKey}-${lead.leadId}-${definition.assigneeUid}`,
          );
          batch.set(adminDb.collection("notifications").doc(taskNotificationKey), {
            recipientUid: definition.assigneeUid,
            title: definition.category,
            body: definition.title,
            read: false,
            priority: definition.priority,
            relatedLeadId: lead.leadId,
            relatedTaskId: taskId,
            source: "crm_automation",
            automationKey: taskNotificationKey,
            createdAt: FieldValue.serverTimestamp(),
          });
          notifications += 1;
          hasWrites = true;
        }
      });

      Array.from(CRON_WORKFLOW_TYPES).forEach((type) => {
        if (desiredTasks.some((definition) => definition.type === type)) return;

        const existingTask = existingTaskByType.get(type);
        const existingData = existingTask?.exists ? (existingTask.data() as Record<string, unknown>) : null;
        if (!existingTask?.exists || existingData?.status === "completed") return;

        batch.set(
          adminDb.collection("tasks").doc(getCrmWorkflowTaskId(type, lead.leadId)),
          {
            status: "completed",
            completedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        workflowTasks += 1;
        hasWrites = true;
      });
    }

    if (hasWrites) {
      await batch.commit();
    }

    await writeServerAudit(adminDb, {
      action: "SYSTEM_CHANGE",
      details: `CRM automation cron processed ${processed} leads.`,
      actor: buildServerActor({
        uid: "cron-crm-automation",
        displayName: "CRM Automation Cron",
        role: "SYSTEM",
        orgRole: "SYSTEM",
      }),
      metadata: {
        processed,
        overdue,
        dueToday,
        stale,
        notifications,
        workflowTasks,
        staleLeadHours,
        overdueEscalationDays,
      },
    });

    return NextResponse.json({
      success: true,
      processed,
      overdue,
      dueToday,
      stale,
      notifications,
      workflowTasks,
      dateKey: todayKey,
    });
  } catch (error) {
    console.error("CRM automation cron failed:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
