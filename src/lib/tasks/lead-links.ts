import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import {
  buildTaskLeadSyncPatch,
  getTaskAssignee,
  normalizeTaskDoc,
  type TaskLeadReference,
} from "@/lib/tasks/model";
import type { LeadDoc } from "@/lib/types/crm";

export async function getLeadTaskReferenceById(leadId: string) {
  if (!db) throw new Error("Firebase is not configured");

  const leadRef = doc(db, "leads", leadId);
  const leadSnap = await getDoc(leadRef);
  if (!leadSnap.exists()) return null;

  return { ...(leadSnap.data() as LeadDoc), leadId: leadSnap.id } as LeadDoc;
}

export async function syncLeadLinkedTasks(input: {
  lead: TaskLeadReference;
  actorUid: string;
  reassignOpenTasksTo?: string | null;
  limitCount?: number;
}) {
  if (!db) throw new Error("Firebase is not configured");

  const firestore = db;
  const taskSnap = await getDocs(
    query(
      collection(firestore, "tasks"),
      where("leadId", "==", input.lead.leadId),
      limit(input.limitCount ?? 400),
    ),
  );

  let synced = 0;
  let reassigned = 0;
  let writes = 0;
  let batch = writeBatch(firestore);

  const commit = async () => {
    if (writes === 0) return;
    await batch.commit();
    batch = writeBatch(firestore);
    writes = 0;
  };

  for (const taskDoc of taskSnap.docs) {
    const task = normalizeTaskDoc(taskDoc.data() as Record<string, unknown>, taskDoc.id);
    const patch: Record<string, unknown> = buildTaskLeadSyncPatch(task, input.lead);
    const status = typeof task.status === "string" ? task.status : "pending";
    const shouldReassign =
      Boolean(input.reassignOpenTasksTo) &&
      status !== "completed" &&
      getTaskAssignee(task) !== input.reassignOpenTasksTo;

    if (shouldReassign) {
      patch.assignedTo = input.reassignOpenTasksTo;
      patch.assigneeUid = input.reassignOpenTasksTo;
      patch.assignedBy = input.actorUid;
      reassigned += 1;
    }

    if (Object.keys(patch).length === 0) continue;

    patch.updatedAt = serverTimestamp();
    batch.set(doc(firestore, "tasks", taskDoc.id), patch, { merge: true });
    synced += 1;
    writes += 1;

    if (writes >= 350) {
      await commit();
    }
  }

  await commit();

  return {
    scanned: taskSnap.size,
    synced,
    reassigned,
  };
}
