import { getAdminDb, admin } from "./lib/firebase-admin.mjs";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const PAGE_SIZE = 250;

function normalizeString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

const leadCache = new Map();

async function getLeadDoc(db, leadId) {
  if (!leadId) return null;
  if (!leadCache.has(leadId)) {
    const snap = await db.collection("leads").doc(leadId).get();
    leadCache.set(leadId, snap.exists ? { leadId: snap.id, ...snap.data() } : null);
  }
  return leadCache.get(leadId);
}

async function getTaskPatch(db, data) {
  const assignedTo = data.assignedTo ?? data.assigneeUid ?? null;
  const createdBy = data.createdBy ?? data.assignedBy ?? null;
  const patch = {};
  const leadId = normalizeString(data.leadId);
  let orphanedLeadLink = false;
  let ownerMismatch = false;

  if (assignedTo && data.assignedTo !== assignedTo) patch.assignedTo = assignedTo;
  if (assignedTo && data.assigneeUid !== assignedTo) patch.assigneeUid = assignedTo;
  if (createdBy && data.assignedBy !== createdBy) patch.assignedBy = createdBy;
  if (createdBy && data.createdBy !== createdBy) patch.createdBy = createdBy;
  if (data.leadId !== undefined && data.leadId !== leadId) patch.leadId = leadId;

  if (leadId) {
    const lead = await getLeadDoc(db, leadId);
    if (!lead) {
      orphanedLeadLink = true;
    } else {
      const leadName = normalizeString(lead.name);
      const leadStatus = normalizeString(String(lead.status ?? ""));
      const leadOwnerUid = normalizeString(lead.assignedTo ?? lead.ownerUid ?? null);

      if (normalizeString(data.leadName) !== leadName) patch.leadName = leadName;
      if (normalizeString(data.leadStatus) !== leadStatus) patch.leadStatus = leadStatus;
      if (normalizeString(data.leadOwnerUid) !== leadOwnerUid) patch.leadOwnerUid = leadOwnerUid;
      if (assignedTo && leadOwnerUid && assignedTo !== leadOwnerUid) ownerMismatch = true;
    }
  }

  return { patch, orphanedLeadLink, ownerMismatch };
}

async function main() {
  const db = getAdminDb();
  let lastDoc = null;
  let scanned = 0;
  let matched = 0;
  let applied = 0;
  let orphanedLeadLinks = 0;
  let ownerMismatches = 0;

  console.log(`Task identity migration starting in ${APPLY ? "apply" : "dry-run"} mode.`);

  while (scanned < LIMIT) {
    let q = db
      .collection("tasks")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(Math.min(PAGE_SIZE, LIMIT - scanned));

    if (lastDoc) {
      q = q.startAfter(lastDoc);
    }

    const snap = await q.get();
    if (snap.empty) break;

    const writes = [];
    for (const doc of snap.docs) {
      scanned += 1;
      const { patch, orphanedLeadLink, ownerMismatch } = await getTaskPatch(db, doc.data());
      if (orphanedLeadLink) {
        orphanedLeadLinks += 1;
        console.log(`[orphaned-lead-link] ${doc.id} -> ${doc.data().leadId}`);
      }
      if (ownerMismatch) {
        ownerMismatches += 1;
        console.log(`[owner-mismatch] ${doc.id}`, {
          taskAssignee: doc.data().assignedTo ?? doc.data().assigneeUid ?? null,
          leadId: doc.data().leadId ?? null,
        });
      }
      if (Object.keys(patch).length === 0) continue;

      matched += 1;
      writes.push({ ref: doc.ref, patch });
      console.log(`[task] ${doc.id}`, patch);
    }

    if (APPLY && writes.length > 0) {
      for (let i = 0; i < writes.length; i += 400) {
        const batch = db.batch();
        for (const write of writes.slice(i, i + 400)) {
          batch.set(write.ref, write.patch, { merge: true });
        }
        await batch.commit();
        applied += Math.min(400, writes.length - i);
      }
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        scanned,
        matched,
        applied: APPLY ? applied : 0,
        orphanedLeadLinks,
        ownerMismatches,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
