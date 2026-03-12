import { arrayUnion, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { syncLeadWorkflowAutomation } from "@/lib/crm/automation-client";
import { applyLeadMutation, buildLeadHistoryEntry } from "@/lib/crm/timeline";
import { isPaymentFollowUpStatus, normalizeLeadStatus } from "@/lib/leads/status";
import { canAssignSalesScope } from "@/lib/sales/hierarchy";
import { syncLeadLinkedTasks } from "@/lib/tasks/lead-links";
import type {
  LeadCustodyState,
  LeadDoc,
  LeadStatus,
  LeadStatusDetail,
  LeadTimelineActor,
  LeadTimelineEvent,
  LeadTransferRecord,
} from "@/lib/types/crm";

export type LeadAssignmentBucket = "oldest" | "newest" | "stale" | "payment_follow_up";

export type LeadAssignmentPreviewInput = {
  leads: LeadDoc[];
  selectedLeadIds: string[];
  mode: "selected" | "count";
  count?: number;
  bucket: LeadAssignmentBucket;
  source?: string | null;
  campaignName?: string | null;
  status?: string | null;
  now?: Date;
};

export type LeadAssignmentPreview = {
  leads: LeadDoc[];
  candidateLeads: LeadDoc[];
  matchingLeads: LeadDoc[];
  skippedLocked: number;
  skippedMerged: number;
};

type LeadTransferMutationInput = {
  lead: LeadDoc;
  actor: LeadTimelineActor;
  nextOwnerUid: string | null;
  nextOwnerName?: string | null;
  reason: string;
  nextStatus?: LeadStatus | null;
  nextSubStatus?: string | null;
  nextStatusDetail?: LeadStatusDetail | null;
  additionalUpdates?: Record<string, unknown>;
};

export type LeadCustodyTransferInput = LeadTransferMutationInput & {
  reassignOpenTasks?: boolean;
  syncWorkflow?: boolean;
  workflowRemarks?: string | null;
};

function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === "object" && value && "seconds" in value && typeof (value as { seconds?: unknown }).seconds === "number") {
    return new Date((value as { seconds: number }).seconds * 1000);
  }
  const next = new Date(value as string | number);
  return Number.isNaN(next.getTime()) ? null : next;
}

function toDateKey(value: Date | null) {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toTextOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toActor(value: unknown, fallback: LeadTimelineActor): LeadTimelineActor {
  if (!isObject(value)) return fallback;
  return {
    uid: toTextOrNull(value.uid) ?? fallback.uid,
    name: toTextOrNull(value.name) ?? fallback.name ?? null,
    role: toTextOrNull(value.role),
    employeeId: toTextOrNull(value.employeeId),
  };
}

function toLeadCustodyState(value: unknown): LeadCustodyState | null {
  switch (value) {
    case "owned":
    case "pulled_back":
    case "pooled":
    case "reassigned":
    case "locked":
      return value;
    default:
      return null;
  }
}

function deriveCustodyState(previousOwnerUid: string | null, currentOwnerUid: string | null): LeadCustodyState {
  if (!currentOwnerUid) return "pooled";
  if (!previousOwnerUid) return "owned";
  if (previousOwnerUid !== currentOwnerUid) return "reassigned";
  return "owned";
}

function transferRecordKey(record: LeadTransferRecord) {
  return [
    toDate(record.transferredAt)?.toISOString() ?? "0",
    record.custodyState,
    record.previousOwnerUid ?? "pool",
    record.currentOwnerUid ?? "pool",
    record.transferredBy?.uid ?? "unknown",
    record.reason.trim().toLowerCase(),
  ].join("|");
}

export function transferRecordFromTimelineEvent(event: LeadTimelineEvent): LeadTransferRecord | null {
  if (event.type !== "reassigned") return null;

  const metadata = isObject(event.metadata) ? event.metadata : {};
  const nestedTransfer = isObject(metadata.transfer) ? metadata.transfer : null;

  const previousOwnerUid =
    toTextOrNull(metadata.previousOwnerUid) ??
    toTextOrNull(nestedTransfer?.previousOwnerUid) ??
    null;
  const currentOwnerUid =
    toTextOrNull(metadata.currentOwnerUid) ??
    toTextOrNull(nestedTransfer?.currentOwnerUid) ??
    null;
  const previousOwnerName =
    toTextOrNull(metadata.previousOwnerName) ??
    toTextOrNull(nestedTransfer?.previousOwnerName) ??
    null;
  const currentOwnerName =
    toTextOrNull(metadata.currentOwnerName) ??
    toTextOrNull(nestedTransfer?.currentOwnerName) ??
    null;

  const reason =
    toTextOrNull(metadata.reason) ??
    toTextOrNull(nestedTransfer?.reason) ??
    toTextOrNull(event.summary);

  if (!reason) return null;

  const custodyState =
    toLeadCustodyState(metadata.custodyState) ??
    toLeadCustodyState(nestedTransfer?.custodyState) ??
    deriveCustodyState(previousOwnerUid, currentOwnerUid);

  const transferId =
    toTextOrNull(metadata.transferId) ??
    toTextOrNull(nestedTransfer?.id) ??
    `timeline-${event.id}`;

  return {
    id: transferId,
    custodyState,
    reason,
    previousOwnerUid,
    previousOwnerName,
    currentOwnerUid,
    currentOwnerName,
    transferredBy: toActor(nestedTransfer?.transferredBy, event.actor),
    transferredAt: event.createdAt,
  };
}

export function buildLeadTransferTimeline(input: {
  transferHistory?: LeadTransferRecord[] | null;
  lastTransfer?: LeadTransferRecord | null;
  timelineEvents?: LeadTimelineEvent[] | null;
}) {
  const merged = new Map<string, LeadTransferRecord>();

  const push = (record: LeadTransferRecord | null | undefined) => {
    if (!record || !toTextOrNull(record.reason)) return;
    const fallbackId = [
      "transfer",
      String(toDate(record.transferredAt)?.getTime() ?? 0),
      record.previousOwnerUid ?? "pool",
      record.currentOwnerUid ?? "pool",
      record.transferredBy?.uid ?? "unknown",
    ].join("-");
    const normalized: LeadTransferRecord = {
      ...record,
      id: toTextOrNull(record.id) ?? fallbackId,
      custodyState:
        toLeadCustodyState(record.custodyState) ??
        deriveCustodyState(record.previousOwnerUid ?? null, record.currentOwnerUid ?? null),
      previousOwnerUid: record.previousOwnerUid ?? null,
      previousOwnerName: record.previousOwnerName ?? null,
      currentOwnerUid: record.currentOwnerUid ?? null,
      currentOwnerName: record.currentOwnerName ?? null,
      transferredBy: toActor(record.transferredBy, {
        uid: "unknown",
        name: "Unknown",
      }),
      transferredAt: record.transferredAt ?? new Date(0),
      reason: record.reason.trim(),
    };
    merged.set(transferRecordKey(normalized), normalized);
  };

  (input.transferHistory ?? []).forEach((entry) => push(entry));
  push(input.lastTransfer);
  (input.timelineEvents ?? [])
    .map((event) => transferRecordFromTimelineEvent(event))
    .forEach((entry) => push(entry));

  return Array.from(merged.values()).sort(
    (left, right) =>
      (toDate(right.transferredAt)?.getTime() ?? 0) -
      (toDate(left.transferredAt)?.getTime() ?? 0),
  );
}

function createTransferId(leadId: string) {
  return `${leadId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertActorCanManageLeadAssignment(actor: LeadTimelineActor) {
  const normalizedRole = (actor.role ?? "").trim().replace(/[\s-]+/g, "_").toUpperCase();
  if (normalizedRole === "SUPER_ADMIN" || normalizedRole === "ADMIN") {
    return;
  }
  if (
    !canAssignSalesScope({
      role: actor.role ?? null,
      orgRole: actor.role ?? null,
    })
  ) {
    throw new Error("Only manager-level roles can assign or pull back leads.");
  }
}

function getLeadSortDate(lead: LeadDoc) {
  return (
    toDate(lead.lastActivityAt) ??
    toDate(lead.nextFollowUp) ??
    toDate(lead.lastActionAt) ??
    toDate(lead.assignedAt) ??
    toDate(lead.updatedAt) ??
    toDate(lead.createdAt) ??
    new Date(0)
  );
}

function getStaleAnchor(lead: LeadDoc) {
  return (
    toDate(lead.lastActivityAt) ??
    toDate(lead.lastActionAt) ??
    toDate(lead.updatedAt) ??
    toDate(lead.createdAt) ??
    new Date(0)
  );
}

function isLeadStale(lead: LeadDoc, now: Date) {
  return now.getTime() - getStaleAnchor(lead).getTime() >= 24 * 60 * 60 * 1000;
}

export function getLeadOwnerUid(lead: Pick<LeadDoc, "assignedTo" | "ownerUid">) {
  return lead.assignedTo ?? lead.ownerUid ?? null;
}

export function getLeadCustodyState(lead: LeadDoc): LeadCustodyState {
  if (lead.custodyState) return lead.custodyState;
  if (lead.mergeState === "merged") return "locked";
  if (lead.statusDetail?.isLocked || normalizeLeadStatus(lead.status) === "closed") return "locked";
  if (!getLeadOwnerUid(lead)) return "pooled";
  return "owned";
}

export function isLeadTransferLocked(lead: LeadDoc) {
  return getLeadCustodyState(lead) === "locked" || lead.mergeState === "merged";
}

export function buildLeadCustodyDefaults(input: {
  ownerUid: string | null;
  actor: LeadTimelineActor;
  reason: string;
  state?: LeadCustodyState;
}) {
  const custodyState = input.state ?? (input.ownerUid ? "owned" : "pooled");
  const transferRecord: LeadTransferRecord = {
    id: createTransferId(input.actor.uid),
    custodyState,
    reason: input.reason.trim(),
    previousOwnerUid: null,
    previousOwnerName: null,
    currentOwnerUid: input.ownerUid,
    currentOwnerName: null,
    transferredBy: input.actor,
    transferredAt: new Date(),
  };

  return {
    custodyState,
    custodyReason: transferRecord.reason,
    custodyUpdatedAt: serverTimestamp(),
    lastTransfer: transferRecord,
    transferHistory: [transferRecord],
  };
}

export function buildLeadTransferMutation(input: LeadTransferMutationInput) {
  const previousOwnerUid = getLeadOwnerUid(input.lead);
  const currentReason = input.reason.trim();
  if (!currentReason) {
    throw new Error("Transfer reason is required.");
  }
  const previousOwnerName =
    input.lead.lastTransfer?.currentOwnerUid === previousOwnerUid
      ? input.lead.lastTransfer.currentOwnerName ?? previousOwnerUid
      : previousOwnerUid;
  const nextOwnerName = input.nextOwnerName ?? input.nextOwnerUid;

  if (isLeadTransferLocked(input.lead) && previousOwnerUid !== input.nextOwnerUid) {
    throw new Error("Locked leads cannot be moved.");
  }

  let custodyState: LeadCustodyState;
  let summary: string;
  let action: string;

  if (!input.nextOwnerUid) {
    custodyState = "pooled";
    summary = "Lead moved to pooled ownership";
    action = "Lead Pooled";
  } else if (input.nextOwnerUid === previousOwnerUid) {
    custodyState = getLeadCustodyState(input.lead);
    summary = `Lead ownership retained with ${nextOwnerName ?? "current owner"}`;
    action = "Lead Ownership Confirmed";
  } else if (input.nextOwnerUid === input.actor.uid && previousOwnerUid && previousOwnerUid !== input.actor.uid) {
    custodyState = "pulled_back";
    summary = `Lead pulled back to ${input.actor.name ?? input.actor.uid}`;
    action = "Lead Pulled Back";
  } else if (previousOwnerUid && previousOwnerUid !== input.nextOwnerUid) {
    custodyState = "reassigned";
    summary = `Lead reassigned to ${nextOwnerName ?? input.nextOwnerUid}`;
    action = "Lead Reassigned";
  } else {
    custodyState = "owned";
    summary = `Lead assigned to ${nextOwnerName ?? input.nextOwnerUid}`;
    action = "Lead Assigned";
  }

  const transferRecord: LeadTransferRecord = {
    id: createTransferId(input.lead.leadId),
    custodyState,
    reason: currentReason,
    previousOwnerUid,
    previousOwnerName: previousOwnerName ?? null,
    currentOwnerUid: input.nextOwnerUid,
    currentOwnerName: nextOwnerName ?? null,
    transferredBy: input.actor,
    transferredAt: new Date(),
  };

  const nextStatus = input.nextStatus ?? input.lead.status;
  const nextLead: LeadDoc = {
    ...input.lead,
    assignedTo: input.nextOwnerUid,
    ownerUid: input.nextOwnerUid,
    assignedBy: input.actor.uid,
    assignedAt: input.nextOwnerUid ? new Date() : null,
    custodyState,
    custodyReason: currentReason,
    custodyUpdatedAt: new Date(),
    lastTransfer: transferRecord,
    transferHistory: [...(input.lead.transferHistory ?? []), transferRecord],
    status: nextStatus,
    subStatus: input.nextSubStatus ?? input.lead.subStatus ?? null,
    statusDetail: input.nextStatusDetail ?? input.lead.statusDetail ?? null,
  };

  const updates: Record<string, unknown> = {
    assignedTo: input.nextOwnerUid,
    ownerUid: input.nextOwnerUid,
    assignedBy: input.actor.uid,
    assignedAt: input.nextOwnerUid ? serverTimestamp() : null,
    custodyState,
    custodyReason: currentReason,
    custodyUpdatedAt: serverTimestamp(),
    lastTransfer: transferRecord,
    transferHistory: arrayUnion(transferRecord),
    ...(input.additionalUpdates ?? {}),
  };

  if (input.nextStatus) {
    updates.status = input.nextStatus;
  }

  if (Object.prototype.hasOwnProperty.call(input, "nextSubStatus")) {
    updates.subStatus = input.nextSubStatus ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(input, "nextStatusDetail")) {
    updates.statusDetail = input.nextStatusDetail ?? null;
  }

  return {
    nextLead,
    transferRecord,
    updates,
    historyEntry: buildLeadHistoryEntry({
      action,
      actor: input.actor,
      oldStatus: previousOwnerName ?? "Unassigned",
      newStatus: nextOwnerName ?? "Pool",
      remarks: currentReason,
    }),
    activityEntry: {
      type: "reassigned" as const,
      at: new Date(),
      note: currentReason,
    },
    timeline: {
      type: "reassigned" as const,
      summary,
      metadata: {
        transferId: transferRecord.id,
        reason: currentReason,
        custodyState,
        previousOwnerUid,
        currentOwnerUid: input.nextOwnerUid,
        previousOwnerName: previousOwnerName ?? null,
        currentOwnerName: nextOwnerName ?? null,
      },
    },
  };
}

export async function transferLeadCustody(input: LeadCustodyTransferInput) {
  const currentOwnerUid = getLeadOwnerUid(input.lead);
  if (currentOwnerUid !== input.nextOwnerUid) {
    assertActorCanManageLeadAssignment(input.actor);
  }

  const mutation = buildLeadTransferMutation(input);

  await applyLeadMutation({
    leadId: input.lead.leadId,
    actor: input.actor,
    updates: mutation.updates,
    historyEntry: mutation.historyEntry,
    activityEntry: mutation.activityEntry,
    timeline: mutation.timeline,
  });

  await syncLeadLinkedTasks({
    lead: mutation.nextLead,
    actorUid: input.actor.uid,
    reassignOpenTasksTo:
      input.reassignOpenTasks !== false && input.nextOwnerUid
        ? input.nextOwnerUid
        : null,
  });

  if (input.syncWorkflow !== false) {
    await syncLeadWorkflowAutomation({
      lead: mutation.nextLead,
      actor: input.actor,
      status: String(mutation.nextLead.status ?? ""),
      followUpDate: toDate(mutation.nextLead.nextFollowUp),
      remarks: input.workflowRemarks ?? mutation.transferRecord.reason,
      stage: mutation.nextLead.statusDetail?.currentStage ?? null,
      reason: mutation.nextLead.statusDetail?.currentReason ?? mutation.transferRecord.reason,
      source: "crm_status_automation",
    });
  }

  if (db && input.nextOwnerUid && input.nextOwnerUid !== input.actor.uid) {
    await setDoc(doc(collection(db, "notifications")), {
      recipientUid: input.nextOwnerUid,
      title: "Lead ownership updated",
      body: `${input.actor.name ?? "CRM"} moved ${mutation.nextLead.name || "a lead"} to your queue.`,
      read: false,
      createdAt: serverTimestamp(),
      priority: "medium",
      source: "crm_custody_transfer",
      leadId: mutation.nextLead.leadId,
    });
  }

  return mutation;
}

export function buildLeadAssignmentPreview(input: LeadAssignmentPreviewInput): LeadAssignmentPreview {
  const now = input.now ?? new Date();
  const scopedLeads = input.leads.filter((lead) => {
    if (lead.mergeState === "merged") return false;
    if (input.source?.trim() && (lead.source ?? "").trim().toLowerCase() !== input.source.trim().toLowerCase()) return false;
    if (input.campaignName?.trim() && (lead.campaignName ?? "").trim().toLowerCase() !== input.campaignName.trim().toLowerCase()) return false;
    if (input.status?.trim() && normalizeLeadStatus(lead.status) !== normalizeLeadStatus(input.status)) return false;
    return true;
  });

  const skippedLocked = scopedLeads.filter((lead) => isLeadTransferLocked(lead)).length;
  const skippedMerged = input.leads.filter((lead) => lead.mergeState === "merged").length;
  const eligible = scopedLeads.filter((lead) => !isLeadTransferLocked(lead));

  if (input.mode === "selected") {
    const selectedSet = new Set(input.selectedLeadIds);
    const selected = eligible.filter((lead) => selectedSet.has(lead.leadId));
    return {
      leads: selected,
      candidateLeads: selected,
      matchingLeads: selected,
      skippedLocked,
      skippedMerged,
    };
  }

  let matchingLeads = [...eligible];
  switch (input.bucket) {
    case "stale":
      matchingLeads = matchingLeads.filter((lead) => isLeadStale(lead, now));
      matchingLeads.sort((left, right) => getStaleAnchor(left).getTime() - getStaleAnchor(right).getTime());
      break;
    case "payment_follow_up":
      matchingLeads = matchingLeads.filter((lead) => isPaymentFollowUpStatus(lead.status));
      matchingLeads.sort((left, right) => getLeadSortDate(left).getTime() - getLeadSortDate(right).getTime());
      break;
    case "newest":
      matchingLeads.sort((left, right) => getLeadSortDate(right).getTime() - getLeadSortDate(left).getTime());
      break;
    case "oldest":
    default:
      matchingLeads.sort((left, right) => getLeadSortDate(left).getTime() - getLeadSortDate(right).getTime());
      break;
  }

  const count = Math.max(0, Math.floor(input.count ?? 0));
  const candidateLeads = count > 0 ? matchingLeads.slice(0, count) : [];
  const selectedSet = new Set(input.selectedLeadIds);
  return {
    leads: candidateLeads.filter((lead) => selectedSet.has(lead.leadId)),
    candidateLeads,
    matchingLeads,
    skippedLocked,
    skippedMerged,
  };
}
