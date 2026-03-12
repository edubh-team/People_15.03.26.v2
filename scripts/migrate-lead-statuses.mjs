import { getAdminDb, admin } from "./lib/firebase-admin.mjs";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const PAGE_SIZE = 250;

const STATUS_ALIASES = {
  new: "new",
  New: "new",
  ringing: "ringing",
  Ringing: "ringing",
  followup: "followup",
  FollowUp: "followup",
  follow_up: "followup",
  contacted: "followup",
  Contacted: "followup",
  warm: "followup",
  Warm: "followup",
  interested: "interested",
  Interested: "interested",
  hot: "interested",
  Hot: "interested",
  not_interested: "not_interested",
  notinterested: "not_interested",
  NotInterested: "not_interested",
  "Not Interested": "not_interested",
  cold: "not_interested",
  Cold: "not_interested",
  wrong_number: "wrong_number",
  wrongnumber: "wrong_number",
  WrongNumber: "wrong_number",
  "Wrong Number": "wrong_number",
  paymentfollowup: "paymentfollowup",
  payment_follow_up: "paymentfollowup",
  PaymentFollowUp: "paymentfollowup",
  converted: "converted",
  Converted: "converted",
  closed: "closed",
  Closed: "closed",
};

function normalizeLeadStatus(status) {
  if (!status) return "new";
  return STATUS_ALIASES[status] ?? STATUS_ALIASES[String(status).trim()] ?? "new";
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLeadPatch(data) {
  const patch = {};
  const currentStatus = typeof data.status === "string" ? data.status : null;
  const normalizedStatus = normalizeLeadStatus(currentStatus);

  if (currentStatus !== normalizedStatus) {
    patch.status = normalizedStatus;
    if (!data.legacyStatus && currentStatus) {
      patch.legacyStatus = currentStatus;
    }
  }

  if (!data.nextFollowUpDateKey && data.nextFollowUp) {
    const nextFollowUp = toDate(data.nextFollowUp);
    if (nextFollowUp) {
      patch.nextFollowUpDateKey = toDateKey(nextFollowUp);
    }
  }

  return patch;
}

async function main() {
  const db = getAdminDb();
  let lastDoc = null;
  let scanned = 0;
  let matched = 0;
  let applied = 0;

  console.log(`Lead status migration starting in ${APPLY ? "apply" : "dry-run"} mode.`);

  while (scanned < LIMIT) {
    let q = db
      .collection("leads")
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
      const patch = getLeadPatch(doc.data());
      if (Object.keys(patch).length === 0) continue;

      matched += 1;
      writes.push({ ref: doc.ref, patch });
      console.log(`[lead] ${doc.id}`, patch);
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
