import {
  arrayUnion,
  collection,
  doc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type {
  LeadActivity,
  LeadActivityDoc,
  LeadStructuredActivityType,
  LeadTimelineActor,
} from "@/lib/types/crm";

type LeadActivityTypeMeta = {
  id: LeadStructuredActivityType;
  label: string;
  description: string;
  channel: LeadActivityDoc["channel"];
  customerTouch: boolean;
};

export const LEAD_ACTIVITY_TYPE_OPTIONS: LeadActivityTypeMeta[] = [
  {
    id: "call_connected",
    label: "Call Connected",
    description: "A meaningful conversation happened with the lead.",
    channel: "call",
    customerTouch: true,
  },
  {
    id: "call_not_connected",
    label: "Call Not Connected",
    description: "An attempt was made, but the lead did not connect.",
    channel: "call",
    customerTouch: true,
  },
  {
    id: "demo_done",
    label: "Demo Done",
    description: "The product or process walkthrough was completed.",
    channel: "meeting",
    customerTouch: true,
  },
  {
    id: "docs_requested",
    label: "Docs Requested",
    description: "The lead was asked to share a document or proof.",
    channel: "document",
    customerTouch: true,
  },
  {
    id: "docs_received",
    label: "Docs Received",
    description: "Requested documents were received from the lead.",
    channel: "document",
    customerTouch: true,
  },
  {
    id: "fee_discussed",
    label: "Fee Discussed",
    description: "Pricing, fee sheet, or payment terms were discussed.",
    channel: "payment",
    customerTouch: true,
  },
  {
    id: "parent_call",
    label: "Parent Call",
    description: "A parent or guardian interaction happened.",
    channel: "call",
    customerTouch: true,
  },
  {
    id: "payment_reminder",
    label: "Payment Reminder",
    description: "A payment-stage reminder or chase was sent.",
    channel: "payment",
    customerTouch: true,
  },
];

const LEAD_ACTIVITY_META = new Map(
  LEAD_ACTIVITY_TYPE_OPTIONS.map((option) => [option.id, option]),
);

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getLeadActivityTypeMeta(type: LeadStructuredActivityType) {
  return LEAD_ACTIVITY_META.get(type) ?? LEAD_ACTIVITY_TYPE_OPTIONS[0]!;
}

export function getLeadActivityTypeLabel(type: LeadStructuredActivityType) {
  return getLeadActivityTypeMeta(type).label;
}

export function isCustomerTouchActivity(type: LeadStructuredActivityType) {
  return getLeadActivityTypeMeta(type).customerTouch;
}

export function mapStatusReasonToActivityType(input: {
  stage: string;
  reason: string;
}): LeadStructuredActivityType {
  const stage = input.stage.toLowerCase();
  const reason = input.reason.toLowerCase();

  if (stage.includes("invalid") || reason.includes("wrong number") || reason.includes("invalid number")) {
    return "call_not_connected";
  }
  if (reason.includes("demo")) return "demo_done";
  if (reason.includes("document")) {
    return reason.includes("received") ? "docs_received" : "docs_requested";
  }
  if (reason.includes("fee")) return "fee_discussed";
  if (reason.includes("parent")) return "parent_call";
  if (
    reason.includes("payment") ||
    reason.includes("application fees") ||
    reason.includes("loan") ||
    reason.includes("utr") ||
    stage.includes("payment follow up")
  ) {
    return "payment_reminder";
  }
  if (
    reason.includes("call back") ||
    reason.includes("callback") ||
    stage.includes("pitch call") ||
    stage.includes("call connected")
  ) {
    return "call_connected";
  }
  return stage.includes("not connected") ? "call_not_connected" : "call_connected";
}

function buildLegacyActivityEntry(input: {
  type: LeadStructuredActivityType;
  note?: string | null;
  happenedAt: Date;
}): LeadActivity {
  return {
    type: isCustomerTouchActivity(input.type) ? "contacted" : "updated",
    at: input.happenedAt,
    note: input.note?.trim() || getLeadActivityTypeLabel(input.type),
  };
}

export async function createLeadStructuredActivity(input: {
  leadId: string;
  actor: LeadTimelineActor;
  type: LeadStructuredActivityType;
  summary?: string | null;
  note?: string | null;
  happenedAt?: Date;
  followUpAt?: Date | null;
  relatedStatus?: string | null;
  metadata?: Record<string, unknown> | null;
  syncFollowUpToLead?: boolean;
}) {
  if (!db) throw new Error("Firebase is not configured");

  const firestore = db;
  const happenedAt = input.happenedAt ?? new Date();
  const typeMeta = getLeadActivityTypeMeta(input.type);
  const summary = input.summary?.trim() || typeMeta.label;
  const note = input.note?.trim() || null;
  const leadRef = doc(firestore, "leads", input.leadId);
  const activityRef = doc(collection(firestore, "leads", input.leadId, "activities"));
  const timelineRef = doc(collection(firestore, "leads", input.leadId, "timeline"));
  const batch = writeBatch(firestore);

  const leadPatch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    lastActionAt: serverTimestamp(),
    lastActionBy: input.actor.uid,
    lastActivityAt: Timestamp.fromDate(happenedAt),
    lastActivityType: input.type,
    activityHistory: arrayUnion(
      buildLegacyActivityEntry({
        type: input.type,
        note: note ?? summary,
        happenedAt,
      }),
    ),
  };

  if (typeMeta.customerTouch) {
    leadPatch.lastContactDateKey = toDateKey(happenedAt);
  }

  if (input.syncFollowUpToLead && input.followUpAt) {
    leadPatch.nextFollowUp = Timestamp.fromDate(input.followUpAt);
    leadPatch.nextFollowUpDateKey = toDateKey(input.followUpAt);
  }

  batch.update(leadRef, leadPatch);
  batch.set(activityRef, {
    type: input.type,
    channel: typeMeta.channel,
    summary,
    note,
    happenedAt: Timestamp.fromDate(happenedAt),
    followUpAt: input.followUpAt ? Timestamp.fromDate(input.followUpAt) : null,
    relatedStatus: input.relatedStatus ?? null,
    actor: input.actor,
    metadata: input.metadata ?? {},
    createdAt: serverTimestamp(),
  } satisfies Omit<LeadActivityDoc, "id">);
  batch.set(timelineRef, {
    type: "activity_logged",
    summary: `${typeMeta.label} logged`,
    actor: input.actor,
    metadata: {
      activityType: input.type,
      summary,
      relatedStatus: input.relatedStatus ?? null,
      followUpAt: input.followUpAt ? input.followUpAt.toISOString() : null,
      ...(input.metadata ?? {}),
    },
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}
