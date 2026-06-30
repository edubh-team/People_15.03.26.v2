import {
  collection,
  doc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { buildTaskLeadWriteFields, buildTaskWriteFields } from "@/lib/tasks/model";
import type {
  LeadDoc,
  LeadDocumentDoc,
  LeadNoteDoc,
  LeadTimelineActor,
} from "@/lib/types/crm";

export type LeadCommandTaskDoc = {
  id: string;
  title: string;
  description: string;
  assignedTo: string | null;
  assigneeUid?: string | null;
  assignedBy?: string | null;
  createdBy?: string | null;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
  category?: string;
  deadline?: unknown | null;
  attachments?: string[];
  createdAt: unknown;
  updatedAt?: unknown;
  leadId?: string | null;
  leadName?: string | null;
  leadStatus?: string | null;
  leadOwnerUid?: string | null;
};

function buildLeadTouchPatch(actor: LeadTimelineActor) {
  return {
    updatedAt: serverTimestamp(),
    lastActionBy: actor.uid,
    lastActionAt: serverTimestamp(),
  };
}

export async function createLeadCommandNote(input: {
  leadId: string;
  actor: LeadTimelineActor;
  body: string;
}) {
  if (!db) throw new Error("Firebase is not configured");

  const firestore = db;
  const leadRef = doc(firestore, "leads", input.leadId);
  const noteRef = doc(collection(firestore, "leads", input.leadId, "notes"));
  const timelineRef = doc(collection(firestore, "leads", input.leadId, "timeline"));
  const batch = writeBatch(firestore);

  batch.update(leadRef, buildLeadTouchPatch(input.actor));
  batch.set(noteRef, {
    body: input.body.trim(),
    author: input.actor,
    createdAt: serverTimestamp(),
  } satisfies Omit<LeadNoteDoc, "id">);
  batch.set(timelineRef, {
    type: "note_added",
    summary: "Lead note added",
    actor: input.actor,
    metadata: {
      notePreview: input.body.trim().slice(0, 140),
    },
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function createLeadCommandDocument(input: {
  leadId: string;
  actor: LeadTimelineActor;
  title: string;
  url: string;
  category: string;
  note?: string | null;
}) {
  if (!db) throw new Error("Firebase is not configured");

  const firestore = db;
  const leadRef = doc(firestore, "leads", input.leadId);
  const documentRef = doc(collection(firestore, "leads", input.leadId, "documents"));
  const timelineRef = doc(collection(firestore, "leads", input.leadId, "timeline"));
  const batch = writeBatch(firestore);

  batch.update(leadRef, buildLeadTouchPatch(input.actor));
  batch.set(documentRef, {
    title: input.title.trim(),
    url: input.url.trim(),
    category: input.category.trim(),
    note: input.note?.trim() || null,
    uploadedBy: input.actor,
    createdAt: serverTimestamp(),
  } satisfies Omit<LeadDocumentDoc, "id">);
  batch.set(timelineRef, {
    type: "document_added",
    summary: "Lead document reference added",
    actor: input.actor,
    metadata: {
      title: input.title.trim(),
      category: input.category.trim(),
    },
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function createLeadCommandTask(input: {
  lead: LeadDoc;
  actor: LeadTimelineActor;
  assigneeUid: string;
  title: string;
  description?: string | null;
  priority: "high" | "medium" | "low";
  deadline?: Date | null;
}) {
  if (!db) throw new Error("Firebase is not configured");

  const firestore = db;
  const leadRef = doc(firestore, "leads", input.lead.leadId);
  const taskRef = doc(collection(firestore, "tasks"));
  const timelineRef = doc(collection(firestore, "leads", input.lead.leadId, "timeline"));
  const batch = writeBatch(firestore);

  batch.update(leadRef, buildLeadTouchPatch(input.actor));
  batch.set(taskRef, {
    id: taskRef.id,
    title: input.title.trim(),
    description: input.description?.trim() || "",
    ...buildTaskWriteFields({
      assigneeUid: input.assigneeUid,
      creatorUid: input.actor.uid,
    }),
    status: "pending",
    priority: input.priority,
    category: "Lead Follow Up",
    deadline: input.deadline ? Timestamp.fromDate(input.deadline) : null,
    attachments: [],
    ...buildTaskLeadWriteFields({ lead: input.lead }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } satisfies Omit<LeadCommandTaskDoc, "id"> & { id: string });
  batch.set(timelineRef, {
    type: "task_created",
    summary: "Follow-up task created",
    actor: input.actor,
    metadata: {
      title: input.title.trim(),
      assigneeUid: input.assigneeUid,
      priority: input.priority,
      deadline: input.deadline ? input.deadline.toISOString() : null,
    },
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}
