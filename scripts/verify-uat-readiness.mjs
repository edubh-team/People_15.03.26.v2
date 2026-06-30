import { getAdminDb } from "./lib/firebase-admin.mjs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PREFIX = sanitize(readArg("--prefix") ?? "");

loadEnvFile(".env.local");
loadEnvFile(".env");

function readArg(name) {
  const hit = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1).trim() : null;
}

function sanitize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function normalizeRole(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, "_");
}

function normalizeLeadStatus(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "");
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function check(name, pass, detail) {
  return { name, pass, detail };
}

function errorMessage(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

async function safeQuery(label, fn) {
  try {
    return { label, snap: await fn(), error: null };
  } catch (error) {
    return { label, snap: null, error: errorMessage(error) };
  }
}

async function main() {
  const now = new Date();
  const today = toDateKey(now);
  const monthKey = toMonthKey(now);
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const projectId = detectProjectId();
  if (!projectId) {
    throw new Error(
      "Unable to detect Firebase project id. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT_KEY before running verify:uat.",
    );
  }

  const db = getAdminDb();

  const [
    usersRes,
    leadsRes,
    leavesPendingRes,
    payrollRes,
    approvalsPendingRes,
    approvalsApprovedRes,
    approvalsRejectedRes,
    smartViewsRes,
    bulkActionsRes,
    presenceTodayRes,
  ] = await Promise.all([
    safeQuery("users", () => db.collection("users").limit(4000).get()),
    safeQuery("leads", () => db.collection("leads").limit(4000).get()),
    safeQuery("leaveRequests.pending", () =>
      db.collection("leaveRequests").where("status", "==", "pending").limit(1000).get(),
    ),
    safeQuery("payroll.currentMonth", () =>
      db.collection("payroll").where("month", "==", monthKey).limit(2000).get(),
    ),
    safeQuery("finance_approval_requests.pending", () =>
      db.collection("finance_approval_requests").where("status", "==", "PENDING").limit(1000).get(),
    ),
    safeQuery("finance_approval_requests.approved", () =>
      db.collection("finance_approval_requests").where("status", "==", "APPROVED").limit(1000).get(),
    ),
    safeQuery("finance_approval_requests.rejected", () =>
      db.collection("finance_approval_requests").where("status", "==", "REJECTED").limit(1000).get(),
    ),
    safeQuery("crm_smart_views", () => db.collection("crm_smart_views").limit(1000).get()),
    safeQuery("crm_bulk_actions", () => db.collection("crm_bulk_actions").limit(1000).get()),
    safeQuery("presence.today", () =>
      db.collection("presence").where("dateKey", "==", today).limit(2000).get(),
    ),
  ]);

  const usersSnap = usersRes.snap;
  const leadsSnap = leadsRes.snap;
  const leavesPendingSnap = leavesPendingRes.snap;
  const payrollSnap = payrollRes.snap;
  const approvalsPendingSnap = approvalsPendingRes.snap;
  const approvalsApprovedSnap = approvalsApprovedRes.snap;
  const approvalsRejectedSnap = approvalsRejectedRes.snap;
  const smartViewsSnap = smartViewsRes.snap;
  const bulkActionsSnap = bulkActionsRes.snap;
  const presenceTodaySnap = presenceTodayRes.snap;

  const queryFailures = [
    usersRes,
    leadsRes,
    leavesPendingRes,
    payrollRes,
    approvalsPendingRes,
    approvalsApprovedRes,
    approvalsRejectedRes,
    smartViewsRes,
    bulkActionsRes,
    presenceTodayRes,
  ].filter((row) => row.error);

  const roleCounts = {
    BDA: 0,
    MANAGER: 0,
    SENIOR_MANAGER: 0,
    HR: 0,
    FINANCER: 0,
    SUPER_ADMIN: 0,
  };

  let payrollReadyUsers = 0;
  for (const row of usersSnap?.docs ?? []) {
    const data = row.data();
    const role = normalizeRole(data.orgRole ?? data.role);
    if (roleCounts[role] !== undefined) roleCounts[role] += 1;
    if ((data.status ?? "active").toLowerCase() !== "inactive" && Number(data.salaryStructure?.base ?? 0) > 0) {
      payrollReadyUsers += 1;
    }
  }

  let hasNew = false;
  let hasDueToday = false;
  let hasOverdue = false;
  let hasStale = false;
  let hasPayment = false;
  let hasClosed = false;
  for (const row of leadsSnap?.docs ?? []) {
    const lead = row.data();
    const status = normalizeLeadStatus(lead.status);
    const followUpKey = typeof lead.nextFollowUpDateKey === "string" ? lead.nextFollowUpDateKey : null;
    const lastActivity = parseDate(lead.lastActivityAt) ?? parseDate(lead.updatedAt) ?? parseDate(lead.createdAt);
    if (status === "new") hasNew = true;
    if (followUpKey === today) hasDueToday = true;
    if (followUpKey && followUpKey < today) hasOverdue = true;
    if (status === "paymentfollowup") hasPayment = true;
    if (status === "closed" || status === "converted") hasClosed = true;
    if (!["closed", "converted", "paymentfollowup"].includes(status) && lastActivity && lastActivity < cutoff) {
      hasStale = true;
    }
  }

  if (PREFIX) {
    const scenarioDocs = {
      new: db.doc(`leads/${PREFIX}_lead_new`),
      dueToday: db.doc(`leads/${PREFIX}_lead_due_today`),
      overdue: db.doc(`leads/${PREFIX}_lead_overdue`),
      stale: db.doc(`leads/${PREFIX}_lead_stale`),
      payment: db.doc(`leads/${PREFIX}_lead_payment_follow_up`),
      closed: db.doc(`leads/${PREFIX}_lead_closed`),
    };

    const [newSnap, dueTodaySnap, overdueSnap, staleSnap, paymentSnap, closedSnap] = await Promise.all([
      scenarioDocs.new.get(),
      scenarioDocs.dueToday.get(),
      scenarioDocs.overdue.get(),
      scenarioDocs.stale.get(),
      scenarioDocs.payment.get(),
      scenarioDocs.closed.get(),
    ]);

    hasNew = newSnap.exists && normalizeLeadStatus(newSnap.data()?.status) === "new";
    hasDueToday =
      dueTodaySnap.exists &&
      typeof dueTodaySnap.data()?.nextFollowUpDateKey === "string" &&
      dueTodaySnap.data().nextFollowUpDateKey === today;
    hasOverdue =
      overdueSnap.exists &&
      typeof overdueSnap.data()?.nextFollowUpDateKey === "string" &&
      overdueSnap.data().nextFollowUpDateKey < today;
    hasStale =
      staleSnap.exists &&
      Boolean(parseDate(staleSnap.data()?.lastActivityAt) && parseDate(staleSnap.data()?.lastActivityAt) < cutoff);
    hasPayment = paymentSnap.exists && normalizeLeadStatus(paymentSnap.data()?.status) === "paymentfollowup";
    hasClosed =
      closedSnap.exists &&
      ["closed", "converted"].includes(normalizeLeadStatus(closedSnap.data()?.status));
  }

  const hasLateOrManualAttendance = (presenceTodaySnap?.docs ?? []).some((row) => {
    const data = row.data();
    return String(data.dayStatus ?? "").toLowerCase() === "late" || data.manualUpdate === true;
  });

  const teamSharedViews = (smartViewsSnap?.docs ?? []).filter((row) => row.data().visibility === "team_shared").length;
  const personalViews = (smartViewsSnap?.docs ?? []).filter((row) => row.data().visibility !== "team_shared").length;

  const checks = [
    check(
      "Firestore query health",
      queryFailures.length === 0,
      queryFailures.length === 0
        ? "all baseline queries succeeded"
        : queryFailures.map((row) => `${row.label}: ${row.error}`).join("; "),
    ),
    check(
      "Role coverage",
      roleCounts.BDA >= 2 &&
        roleCounts.MANAGER >= 1 &&
        roleCounts.SENIOR_MANAGER >= 1 &&
        roleCounts.HR >= 1 &&
        roleCounts.FINANCER >= 1 &&
        roleCounts.SUPER_ADMIN >= 1,
      `BDA=${roleCounts.BDA}, Manager=${roleCounts.MANAGER}, SeniorManager=${roleCounts.SENIOR_MANAGER}, HR=${roleCounts.HR}, Finance=${roleCounts.FINANCER}, SuperAdmin=${roleCounts.SUPER_ADMIN}`,
    ),
    check(
      "Lead scenario coverage",
      hasNew && hasDueToday && hasOverdue && hasStale && hasPayment && hasClosed,
      `new=${hasNew}, dueToday=${hasDueToday}, overdue=${hasOverdue}, stale=${hasStale}, payment=${hasPayment}, closed=${hasClosed}`,
    ),
    check(
      "HR baseline coverage",
      (leavesPendingSnap?.size ?? 0) > 0 && hasLateOrManualAttendance,
      `pendingLeaves=${leavesPendingSnap?.size ?? 0}, attendanceLateOrManual=${hasLateOrManualAttendance}`,
    ),
    check(
      "Payroll baseline coverage",
      payrollReadyUsers > 0 && (payrollSnap?.size ?? 0) > 0,
      `payrollReadyUsers=${payrollReadyUsers}, payrollRowsForMonth=${payrollSnap?.size ?? 0}`,
    ),
    check(
      "Finance approvals baseline",
      (approvalsPendingSnap?.size ?? 0) > 0 &&
        (approvalsApprovedSnap?.size ?? 0) > 0 &&
        (approvalsRejectedSnap?.size ?? 0) > 0,
      `pending=${approvalsPendingSnap?.size ?? 0}, approved=${approvalsApprovedSnap?.size ?? 0}, rejected=${approvalsRejectedSnap?.size ?? 0}`,
    ),
    check(
      "CRM smart views baseline",
      teamSharedViews > 0 && personalViews > 0,
      `teamShared=${teamSharedViews}, personal=${personalViews}`,
    ),
    check(
      "Bulk execution logs baseline",
      (bulkActionsSnap?.size ?? 0) > 0,
      `batches=${bulkActionsSnap?.size ?? 0}`,
    ),
  ];

  if (PREFIX) {
    const prefixChecks = [
      db.doc(`users/${PREFIX}_manager`).get(),
      db.doc(`users/${PREFIX}_bda_1`).get(),
      db.doc(`leads/${PREFIX}_lead_due_today`).get(),
      db.doc(`finance_approval_requests/${PREFIX}_approval_pending_1`).get(),
    ];
    const [managerSnap, bdaSnap, leadSnap, approvalSnap] = await Promise.all(prefixChecks);
    checks.push(
      check(
        "Seed prefix integrity",
        managerSnap.exists && bdaSnap.exists && leadSnap.exists && approvalSnap.exists,
        `manager=${managerSnap.exists}, bda1=${bdaSnap.exists}, leadDueToday=${leadSnap.exists}, financePending=${approvalSnap.exists}`,
      ),
    );
  }

  const allPass = checks.every((row) => row.pass);
  console.log(`UAT readiness (${today}) for project ${projectId}`);
  for (const row of checks) {
    console.log(`${row.pass ? "PASS" : "FAIL"} | ${row.name} | ${row.detail}`);
  }

  if (!allPass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
