import { getAdminDb } from "./lib/firebase-admin.mjs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const PREFIX = sanitize(readArg("--prefix") ?? "uat_q2_2026");
const DAY_MS = 24 * 60 * 60 * 1000;

loadEnvFile(".env.local");
loadEnvFile(".env");

function readArg(name) {
  const hit = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1).trim() : null;
}

function sanitize(value) {
  return String(value ?? "uat")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "uat";
}

function loadEnvFile(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const delimiter = line.indexOf("=");
    if (delimiter < 1) continue;
    const key = line.slice(0, delimiter).trim();
    if (!key || process.env[key]) continue;
    let value = line.slice(delimiter + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function id(suffix) {
  return `${PREFIX}_${suffix}`;
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toMonthKey(date) {
  return toDateKey(date).slice(0, 7);
}

function detectProjectId() {
  if (process.env.GCLOUD_PROJECT?.trim()) return process.env.GCLOUD_PROJECT.trim();
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()) {
    return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID.trim();
  }
  if (process.env.FIREBASE_CONFIG) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_CONFIG);
      if (typeof parsed?.projectId === "string" && parsed.projectId.trim()) {
        return parsed.projectId.trim();
      }
    } catch {}
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      if (typeof parsed?.project_id === "string" && parsed.project_id.trim()) {
        return parsed.project_id.trim();
      }
    } catch {}
  }
  return null;
}

function buildIds() {
  const resolve = (name, envName) => process.env[envName]?.trim() || id(name);
  return {
    superAdmin: resolve("super_admin", "UAT_SUPER_ADMIN_UID"),
    seniorManager: resolve("senior_manager", "UAT_SENIOR_MANAGER_UID"),
    manager: resolve("manager", "UAT_MANAGER_UID"),
    bda1: resolve("bda_1", "UAT_BDA1_UID"),
    bda2: resolve("bda_2", "UAT_BDA2_UID"),
    hr: resolve("hr", "UAT_HR_UID"),
    finance: resolve("finance", "UAT_FINANCE_UID"),
  };
}

function queueWrite(writes, path, data) {
  writes.push({ path, data });
}

function summarize(writes) {
  const out = {};
  for (const row of writes) {
    const root = row.path.split("/")[0];
    out[root] = (out[root] ?? 0) + 1;
  }
  return out;
}

async function commitWrites(db, writes) {
  const CHUNK = 350;
  let done = 0;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const batch = db.batch();
    for (const row of writes.slice(i, i + CHUNK)) {
      batch.set(db.doc(row.path), row.data, { merge: true });
    }
    await batch.commit();
    done += Math.min(CHUNK, writes.length - i);
    console.log(`Committed ${done}/${writes.length}`);
  }
}

async function main() {
  const ids = buildIds();
  const now = new Date();
  const today = toDateKey(now);
  const yesterday = toDateKey(new Date(now.getTime() - DAY_MS));
  const twoDaysAgo = toDateKey(new Date(now.getTime() - 2 * DAY_MS));
  const monthKey = toMonthKey(now);
  const [year, month] = today.split("-");
  const writes = [];

  const actor = (uid, name, role) => ({ uid, name, role });
  const managerActor = actor(ids.manager, "UAT Manager", "MANAGER");
  const bda1Actor = actor(ids.bda1, "UAT BDA 1", "BDA");

  const users = [
    [ids.superAdmin, "UAT Super Admin", "admin", "SUPER_ADMIN", null, null],
    [ids.seniorManager, "UAT Senior Manager", "seniorManager", "SENIOR_MANAGER", ids.superAdmin, ids.superAdmin],
    [ids.manager, "UAT Manager", "manager", "MANAGER", ids.seniorManager, ids.seniorManager],
    [ids.bda1, "UAT BDA 1", "bda", "BDA", ids.manager, ids.manager],
    [ids.bda2, "UAT BDA 2", "bda", "BDA", ids.manager, ids.manager],
    [ids.hr, "UAT HR", "hr", "HR", ids.superAdmin, ids.superAdmin],
    [ids.finance, "UAT Finance", "financer", "FINANCER", ids.superAdmin, ids.superAdmin],
  ];

  for (const [uid, displayName, role, orgRole, reportsTo, managerId] of users) {
    queueWrite(writes, `users/${uid}`, {
      uid,
      employeeId: id(`EMP_${uid.slice(-6)}`),
      email: `${uid}@uat.local`,
      displayName,
      role,
      orgRole,
      reportsTo,
      managerId,
      teamLeadId: null,
      assignedHR: role === "bda" ? ids.hr : null,
      status: "active",
      isActive: true,
      salaryStructure: role === "bda" ? { base: 25000, bonusRate: 0.08, deductionRate: 0.02 } : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  const mkLead = (leadId, name, status, assignedTo, opts = {}) => ({
    leadId,
    name,
    phone: String(9000000000 + Math.floor(Math.random() * 999999)),
    email: `${leadId}@mail.local`,
    status,
    assignedTo,
    ownerUid: assignedTo,
    assignedBy: ids.manager,
    assignedAt: opts.assignedAt ?? now,
    lastActivityAt: opts.lastActivityAt ?? now,
    nextFollowUpDateKey: opts.nextFollowUpDateKey ?? null,
    nextFollowUp: opts.nextFollowUp ?? null,
    lastContactDateKey: opts.lastContactDateKey ?? null,
    statusDetail: {
      currentStage: status,
      currentReason: opts.reason ?? "UAT seeded lead",
      history: [{ stage: status, reason: opts.reason ?? "UAT seeded lead", updatedAt: now }],
      lastUpdated: now,
    },
    activityHistory: [],
    kycData: { aadhar: null, pan: null, address: null, parentDetails: null },
    createdDateKey: opts.createdDateKey ?? twoDaysAgo,
    source: opts.source ?? "UAT Seed",
    campaignName: opts.campaignName ?? "Q2 UAT",
    custodyState: opts.custodyState ?? "owned",
    custodyReason: opts.custodyReason ?? null,
    mergeState: "active",
    duplicateFlag: false,
    createdBy: managerActor,
    createdAt: opts.createdAt ?? now,
    updatedAt: opts.updatedAt ?? now,
  });

  const leadIds = {
    new: id("lead_new"),
    dueToday: id("lead_due_today"),
    overdue: id("lead_overdue"),
    stale: id("lead_stale"),
    payment: id("lead_payment_follow_up"),
    closed: id("lead_closed"),
    pooled: id("lead_pooled"),
    pulledBack: id("lead_pulled_back"),
  };

  const seededLeads = [
    mkLead(leadIds.new, "Aarav New Lead", "new", ids.bda1, { reason: "Fresh assignment", createdDateKey: twoDaysAgo }),
    mkLead(leadIds.dueToday, "Riya Due Today", "followup", ids.bda1, {
      nextFollowUpDateKey: today,
      nextFollowUp: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      lastContactDateKey: today,
      reason: "Callback promised today",
    }),
    mkLead(leadIds.overdue, "Kabir Overdue", "followup", ids.bda2, {
      nextFollowUpDateKey: yesterday,
      nextFollowUp: new Date(now.getTime() - 8 * 60 * 60 * 1000),
      lastActivityAt: new Date(now.getTime() - 30 * 60 * 60 * 1000),
      reason: "Overdue callback pending",
    }),
    mkLead(leadIds.stale, "Meera Stale Lead", "interested", ids.bda2, {
      lastActivityAt: new Date(now.getTime() - 50 * 60 * 60 * 1000),
      lastContactDateKey: twoDaysAgo,
      reason: "Awaiting re-engagement",
    }),
    mkLead(leadIds.payment, "Ishaan Payment Follow Up", "paymentfollowup", ids.bda1, {
      nextFollowUpDateKey: today,
      reason: "Awaiting payment confirmation",
      campaignName: "Payment Follow-up",
    }),
    {
      ...mkLead(leadIds.closed, "Sana Closed Won", "closed", ids.bda1, { custodyState: "locked", reason: "Admission confirmed" }),
      closedAt: new Date(now.getTime() - DAY_MS),
      subStatus: "Registration Done",
      enrollmentDetails: {
        university: "Sample University",
        course: "MBA",
        fee: 120000,
        emiDetails: "12 month EMI",
        paymentMode: "UPI",
        utrNumber: id("utr_1"),
        closedAt: new Date(now.getTime() - DAY_MS),
      },
      closedBy: { uid: ids.bda1, name: "UAT BDA 1", employeeId: id("EMP_BDA1") },
    },
    mkLead(leadIds.pooled, "Pool Queue Lead", "new", null, { custodyState: "pooled", custodyReason: "Awaiting assignment" }),
    mkLead(leadIds.pulledBack, "Manager Pullback Lead", "followup", ids.manager, {
      custodyState: "pulled_back",
      custodyReason: "Pulled back by manager before redistribution.",
      reason: "Manager quality review",
    }),
  ];

  for (const lead of seededLeads) queueWrite(writes, `leads/${lead.leadId}`, lead);

  queueWrite(writes, `leads/${leadIds.pulledBack}/timeline/${id("timeline_reassign_1")}`, {
    type: "reassigned",
    summary: "Lead pulled back by manager before redistribution.",
    actor: managerActor,
    metadata: { reason: "Pulled back by manager before redistribution.", previousOwnerUid: ids.bda2, currentOwnerUid: ids.manager },
    createdAt: now,
  });
  queueWrite(writes, `leads/${leadIds.dueToday}/activities/${id("activity_1")}`, {
    type: "call_connected",
    channel: "call",
    summary: "Connected with student and confirmed callback.",
    note: "Requested fee breakup and follow-up at 5 PM.",
    happenedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    followUpAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
    relatedStatus: "followup",
    actor: bda1Actor,
    metadata: {},
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
  });

  queueWrite(writes, `tasks/${id("task_due_today")}`, {
    id: id("task_due_today"),
    title: "Callback follow-up",
    leadId: leadIds.dueToday,
    leadName: "Riya Due Today",
    leadStatus: "followup",
    leadOwnerUid: ids.bda1,
    assignedTo: ids.bda1,
    assigneeUid: ids.bda1,
    assignedBy: ids.manager,
    createdBy: ids.manager,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  queueWrite(writes, `crm_smart_views/${id("view_personal_bda1")}`, {
    id: id("view_personal_bda1"),
    name: "BDA Due Today Priority",
    ownerUid: ids.bda1,
    ownerName: "UAT BDA 1",
    baseTabId: "due_today",
    filters: { searchTerm: "", status: "followup", ownerUid: ids.bda1 },
    pinned: true,
    isDefault: true,
    visibility: "personal",
    sharedWithUserUids: [],
    createdAt: now,
    updatedAt: now,
  });
  queueWrite(writes, `crm_smart_views/${id("view_team_manager")}`, {
    id: id("view_team_manager"),
    name: "Manager No Activity 24h",
    ownerUid: ids.manager,
    ownerName: "UAT Manager",
    baseTabId: "no_activity_24h",
    filters: { searchTerm: "", status: "all", ownerUid: "all" },
    pinned: true,
    isDefault: false,
    visibility: "team_shared",
    sharedWithUserUids: [ids.bda1, ids.bda2],
    createdAt: now,
    updatedAt: now,
  });

  queueWrite(writes, `crm_bulk_actions/${id("batch_ok")}`, {
    batchId: id("batch_ok"),
    actor: managerActor,
    summary: "Bulk stale rescue run",
    state: "completed",
    requested: 5,
    updated: 5,
    writeFailureCount: 0,
    sideEffectFailureCount: 0,
    startedAt: new Date(now.getTime() - 30 * 60 * 1000),
    completedAt: new Date(now.getTime() - 20 * 60 * 1000),
  });
  queueWrite(writes, `crm_bulk_actions/${id("batch_issues")}`, {
    batchId: id("batch_issues"),
    actor: managerActor,
    summary: "Overdue recovery run",
    state: "completed_with_issues",
    requested: 6,
    updated: 4,
    writeFailureCount: 1,
    sideEffectFailureCount: 1,
    startedAt: new Date(now.getTime() - 15 * 60 * 1000),
    completedAt: new Date(now.getTime() - 5 * 60 * 1000),
  });
  queueWrite(writes, `crm_bulk_actions/${id("batch_issues")}/lead_failures/${id("failure_1")}`, {
    leadId: leadIds.overdue,
    step: "workflow_sync",
    error: "Failed to queue escalation task.",
    createdAt: new Date(now.getTime() - 5 * 60 * 1000),
  });

  queueWrite(writes, `leaveRequests/${id("leave_pending_1")}`, {
    uid: ids.bda1,
    startDateKey: today,
    endDateKey: today,
    type: "casual",
    status: "pending",
    reason: "Medical appointment in afternoon",
    attachmentUrl: null,
    assignedHR: ids.hr,
    createdAt: now,
    updatedAt: now,
  });
  queueWrite(writes, `presence/${id("presence_bda1_today")}`, {
    uid: ids.bda1,
    dateKey: today,
    status: "checked_in",
    dayStatus: "late",
    checkedInAt: new Date(`${today}T10:35:00`),
    updatedAt: now,
  });
  queueWrite(writes, `users/${ids.bda1}/attendance/${year}/months/${month}/days/${today}`, {
    uid: ids.bda1,
    userId: ids.bda1,
    dateKey: today,
    status: "checked_in",
    dayStatus: "late",
    checkInTime: new Date(`${today}T10:35:00`),
    checkedInAt: new Date(`${today}T10:35:00`),
    manualUpdate: true,
    createdAt: new Date(`${today}T10:35:00`),
    updatedAt: now,
  });
  queueWrite(writes, `payroll/${id(`payroll_${ids.bda1}_${monthKey}`)}`, {
    uid: ids.bda1,
    month: monthKey,
    netSalary: 26200,
    status: "GENERATED",
    generatedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  queueWrite(writes, `finance_approval_requests/${id("approval_pending_1")}`, {
    action: "CREATE_TRANSACTION",
    status: "PENDING",
    summary: "Pending debit approval for marketing vendor payout",
    requestedBy: actor(ids.finance, "UAT Finance", "FINANCER"),
    createdAt: now,
    updatedAt: now,
  });
  queueWrite(writes, `finance_approval_requests/${id("approval_approved_1")}`, {
    action: "CREATE_TRANSACTION",
    status: "APPROVED",
    summary: "Approved credit reconciliation entry",
    requestedBy: actor(ids.finance, "UAT Finance", "FINANCER"),
    reviewedBy: actor(ids.superAdmin, "UAT Super Admin", "SUPER_ADMIN"),
    createdAt: new Date(now.getTime() - 2 * DAY_MS),
    updatedAt: new Date(now.getTime() - DAY_MS),
    decidedAt: new Date(now.getTime() - DAY_MS),
  });
  queueWrite(writes, `finance_approval_requests/${id("approval_rejected_1")}`, {
    action: "DELETE_TRANSACTION",
    status: "REJECTED",
    summary: "Rejected delete request for audited transaction",
    requestedBy: actor(ids.finance, "UAT Finance", "FINANCER"),
    reviewedBy: actor(ids.superAdmin, "UAT Super Admin", "SUPER_ADMIN"),
    createdAt: new Date(now.getTime() - 3 * DAY_MS),
    updatedAt: new Date(now.getTime() - 2 * DAY_MS),
    decidedAt: new Date(now.getTime() - 2 * DAY_MS),
  });
  queueWrite(writes, `finance_audit_events/${id("audit_pending_1")}`, {
    eventType: "approval_requested",
    action: "FINANCE_APPROVAL_REQUESTED",
    summary: "Pending debit approval for marketing vendor payout",
    actor: actor(ids.finance, "UAT Finance", "FINANCER"),
    approvalRequestId: id("approval_pending_1"),
    createdAt: now,
  });

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        prefix: PREFIX,
        today,
        monthKey,
        totalWrites: writes.length,
        collections: summarize(writes),
        ids,
      },
      null,
      2,
    ),
  );

  if (!APPLY) {
    console.log("Dry-run complete. Re-run with --apply to write fixtures.");
    return;
  }

  const projectId = detectProjectId();
  if (!projectId) {
    throw new Error(
      "Unable to detect Firebase project id. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT_KEY before using --apply.",
    );
  }

  console.log(`Writing staging fixtures into project \"${projectId}\"...`);
  const db = getAdminDb();
  await commitWrites(db, writes);
  console.log("Staging UAT fixture seed completed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
