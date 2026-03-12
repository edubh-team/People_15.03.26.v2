import { getAdminDb } from "./lib/firebase-admin.mjs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

loadEnvFile(".env.local");
loadEnvFile(".env");

const CYCLE_DAYS = 14;
const SALES_TARGET_PER_CYCLE = 1;
const ROLLING_CYCLES = 3;
const ANCHOR_ISO = "2026-01-05T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

const CYCLES_TO_SIMULATE = Math.max(1, Number(readArg("--cycles") ?? "2"));
const PREFIX = sanitize(readArg("--prefix") ?? "");
const APPLY = process.argv.includes("--apply");

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
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    const parsed = value.toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value?.seconds === "number") {
    const parsed = new Date(value.seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateStart(value) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatDateLabel(value) {
  const dd = String(value.getDate()).padStart(2, "0");
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function getAnchorDate() {
  const parsed = new Date(ANCHOR_ISO);
  return Number.isNaN(parsed.getTime()) ? toDateStart(new Date("2026-01-05T00:00:00.000Z")) : toDateStart(parsed);
}

function getCycleIndex(referenceDate) {
  const anchor = getAnchorDate().getTime();
  const ref = toDateStart(referenceDate).getTime();
  return Math.floor((ref - anchor) / (CYCLE_DAYS * DAY_MS));
}

function getCycleWindow(index) {
  const anchor = getAnchorDate();
  const start = new Date(anchor.getTime() + index * CYCLE_DAYS * DAY_MS);
  const endExclusive = new Date(start.getTime() + CYCLE_DAYS * DAY_MS);
  const endInclusive = new Date(endExclusive.getTime() - DAY_MS);
  return {
    index,
    start,
    endExclusive,
    label: `${formatDateLabel(start)} - ${formatDateLabel(endInclusive)}`,
  };
}

function countSalesInWindow(salesDates, window) {
  const startMs = window.start.getTime();
  const endMs = window.endExclusive.getTime();
  return salesDates.reduce((total, value) => {
    const ts = value.getTime();
    if (ts >= startMs && ts < endMs) return total + 1;
    return total;
  }, 0);
}

function scoreToStatus(rollingSales) {
  const rollingTarget = SALES_TARGET_PER_CYCLE * ROLLING_CYCLES;
  if (rollingSales >= rollingTarget) return "on_track";
  if (rollingSales === Math.max(rollingTarget - 1, 0)) return "at_risk";
  return "missed";
}

function estimateNextSales(recentCycles) {
  if (recentCycles.length === 0) return 0;
  const total = recentCycles.reduce((sum, value) => sum + value, 0);
  const average = total / recentCycles.length;
  return Math.max(0, Math.floor(average));
}

function formatLine(parts) {
  return parts.map((value) => String(value).padEnd(16, " ")).join(" ");
}

async function main() {
  const projectId = detectProjectId();
  if (!projectId) {
    throw new Error(
      "Unable to detect Firebase project id. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT_KEY.",
    );
  }

  const db = getAdminDb();
  const [usersSnap, leadsSnap, pipSnap] = await Promise.all([
    db.collection("users").limit(4000).get(),
    db.collection("leads").limit(8000).get(),
    db.collection("bda_pip_cases").limit(3000).get(),
  ]);

  const users = usersSnap.docs.map((row) => ({ ...row.data(), uid: row.id }));
  const bdas = users.filter((user) => {
    if (PREFIX && !String(user.uid).startsWith(PREFIX)) return false;
    if (normalizeRole(user.orgRole ?? user.role) !== "BDA") return false;
    if (String(user.status ?? "").toLowerCase() === "terminated") return false;
    return true;
  });

  const pipByBda = new Map();
  pipSnap.docs.forEach((row) => {
    const data = row.data();
    if (!data?.bdaUid) return;
    const current = pipByBda.get(data.bdaUid);
    if (!current || toDate(data.updatedAt)?.getTime() > toDate(current.updatedAt)?.getTime()) {
      pipByBda.set(data.bdaUid, { id: row.id, ...data });
    }
  });

  const salesDatesByBda = new Map();
  leadsSnap.docs.forEach((row) => {
    const data = row.data();
    const status = String(data.status ?? "").toLowerCase();
    if (!["closed", "converted"].includes(status)) return;
    const ownerUid = data.ownerUid ?? data.assignedTo ?? null;
    if (!ownerUid) return;
    const closedDate = toDate(data.enrollmentDetails?.closedAt ?? data.closedAt ?? data.updatedAt ?? data.createdAt);
    if (!closedDate) return;
    if (!salesDatesByBda.has(ownerUid)) salesDatesByBda.set(ownerUid, []);
    salesDatesByBda.get(ownerUid).push(closedDate);
  });

  const now = new Date();
  const currentCycleIndex = getCycleIndex(now);
  const outputRows = [];

  for (const bda of bdas) {
    const salesDates = salesDatesByBda.get(bda.uid) ?? [];
    const rollingIndexes = [currentCycleIndex - 2, currentCycleIndex - 1, currentCycleIndex];
    const rollingSales = rollingIndexes.map((index) => countSalesInWindow(salesDates, getCycleWindow(index)));
    const currentStatus = scoreToStatus(rollingSales.reduce((sum, value) => sum + value, 0));
    const predictedSales = [];
    let simulationWindow = [...rollingSales];

    for (let i = 1; i <= CYCLES_TO_SIMULATE; i += 1) {
      const projected = estimateNextSales(simulationWindow);
      predictedSales.push(projected);
      simulationWindow = [...simulationWindow.slice(1), projected];
    }

    const predictedStatus = scoreToStatus(simulationWindow.reduce((sum, value) => sum + value, 0));
    const pipCase = pipByBda.get(bda.uid);
    const pipStatus = pipCase ? String(pipCase.status ?? "active") : "none";
    const pipTriggerNext = currentStatus === "missed" ? "yes" : "no";

    outputRows.push({
      uid: bda.uid,
      name: bda.displayName ?? bda.email ?? bda.uid,
      currentStatus,
      rollingSales: rollingSales.join("/"),
      projections: predictedSales.join("/"),
      predictedStatus,
      pipStatus,
      pipTriggerNext,
    });
  }

  outputRows.sort((left, right) => left.name.localeCompare(right.name));

  console.log("");
  console.log(`Bi-weekly dry-run simulation | project=${projectId} | cycles=${CYCLES_TO_SIMULATE}`);
  console.log(`Current cycle index: ${currentCycleIndex} (${getCycleWindow(currentCycleIndex).label})`);
  console.log(formatLine(["BDA", "Current", "Rolling3", `Next${CYCLES_TO_SIMULATE}`, "Predicted", "PIP", "Trigger?"]));
  console.log("-".repeat(120));
  outputRows.forEach((row) => {
    console.log(
      formatLine([
        row.name.slice(0, 15),
        row.currentStatus,
        row.rollingSales,
        row.projections,
        row.predictedStatus,
        row.pipStatus,
        row.pipTriggerNext,
      ]),
    );
  });

  if (APPLY) {
    const runId = `sim_${Date.now()}`;
    await db.collection("uat_biweekly_simulations").doc(runId).set({
      id: runId,
      projectId,
      prefix: PREFIX || null,
      cyclesSimulated: CYCLES_TO_SIMULATE,
      anchorDateIso: ANCHOR_ISO,
      currentCycleIndex,
      currentCycleLabel: getCycleWindow(currentCycleIndex).label,
      rows: outputRows,
      createdAt: new Date(),
    });
    console.log(`Saved simulation result to uat_biweekly_simulations/${runId}`);
  } else {
    console.log("Dry-run only. Use --apply to persist simulation output.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
