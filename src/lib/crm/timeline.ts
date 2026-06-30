import {
  collection,
  doc,
  writeBatch,
  arrayUnion,
  serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type {
  LeadActivity,
  LeadAuditLog,
  LeadTimelineActor,
  LeadTimelineEventType,
} from "@/lib/types/crm";

export function buildLeadActor(input: {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  role?: string | null;
  orgRole?: string | null;
  employeeId?: string | null;
}): LeadTimelineActor {
  return {
    uid: input.uid,
    name: input.displayName?.trim() || input.email?.trim() || "Unknown",
    role: input.orgRole?.trim() || input.role?.trim() || null,
    employeeId: input.employeeId ?? null,
  };
}

export function buildLeadHistoryEntry(input: {
  action: string;
  actor: LeadTimelineActor;
  oldStatus?: string | null;
  newStatus?: string | null;
  remarks?: string | null;
  timestamp?: Date;
}): LeadAuditLog {
  return {
    action: input.action,
    oldStatus: input.oldStatus ?? undefined,
    newStatus: input.newStatus ?? undefined,
    remarks: input.remarks ?? undefined,
    updatedBy: input.actor.uid,
    updatedByName: input.actor.name ?? undefined,
    timestamp: input.timestamp ?? new Date(),
  };
}

export async function applyLeadMutation(input: {
  leadId: string;
  actor: LeadTimelineActor;
  updates: Record<string, unknown>;
  timeline: {
    type: LeadTimelineEventType;
    summary: string;
    metadata?: Record<string, unknown>;
  };
  historyEntry?: LeadAuditLog | null;
  activityEntry?: LeadActivity | null;
}) {
  if (!db) throw new Error("Firebase is not configured");

  const firestore = db;
  const batch = writeBatch(firestore);
  const leadRef = doc(firestore, "leads", input.leadId);
  const timelineRef = doc(collection(firestore, "leads", input.leadId, "timeline"));

  const patch: Record<string, unknown> = {
    ...input.updates,
    updatedAt: serverTimestamp(),
    lastActionBy: input.actor.uid,
    lastActionAt: serverTimestamp(),
  };

  if (input.historyEntry) {
    patch.history = arrayUnion(input.historyEntry);
  }

  if (input.activityEntry) {
    patch.activityHistory = arrayUnion(input.activityEntry);
  }

  batch.update(leadRef, patch);
  batch.set(timelineRef, {
    type: input.timeline.type,
    summary: input.timeline.summary,
    actor: input.actor,
    metadata: input.timeline.metadata ?? {},
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function appendLeadTimelineEvent(input: {
  leadId: string;
  actor: LeadTimelineActor;
  type: LeadTimelineEventType;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  if (!db) throw new Error("Firebase is not configured");

  const timelineRef = doc(collection(db, "leads", input.leadId, "timeline"));
  const batch = writeBatch(db);
  batch.set(timelineRef, {
    type: input.type,
    summary: input.summary,
    actor: input.actor,
    metadata: input.metadata ?? {},
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

