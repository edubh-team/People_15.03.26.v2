import {
  arrayUnion,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { syncLeadWorkflowAutomation } from "@/lib/crm/automation-client";
import { buildLeadTransferMutation } from "@/lib/crm/custody";
import { buildLeadHistoryEntry } from "@/lib/crm/timeline";
import { canAssignSalesScope } from "@/lib/sales/hierarchy";
import { syncLeadLinkedTasks } from "@/lib/tasks/lead-links";
import {
  getLeadStatusLabel,
  isFollowUpStatus,
  isPaymentFollowUpStatus,
  normalizeLeadStatus,
} from "@/lib/leads/status";
import type { LeadDoc, LeadStatus, LeadTimelineActor } from "@/lib/types/crm";

export type BulkLeadActionInput = {
  leads: LeadDoc[];
  actor: LeadTimelineActor;
  assignTo?: string | null;
  status?: LeadStatus | null;
  followUpAt?: Date | null;
  source?: string | null;
  campaignName?: string | null;
  remarks?: string | null;
  transferReason?: string | null;
};

export type BulkLeadActionResult = {
  requested: number;
  updated: number;
  writeFailures: Array<{
    leadId: string;
    step: "write_validation" | "write_commit";
    error: string;
  }>;
  batchId: string | null;
  sideEffectFailures: Array<{
    leadId: string;
    step: "task_sync" | "workflow_sync";
    error: string;
  }>;
};

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildBulkActionSummary(input: BulkLeadActionInput) {
  const parts: string[] = [];
  if (input.assignTo) parts.push("owner updated");
  if (input.status) parts.push(`status -> ${getLeadStatusLabel(input.status)}`);
  if (input.followUpAt) parts.push(`follow-up -> ${toDateKey(input.followUpAt)}`);
  if (input.source) parts.push(`source -> ${input.source}`);
  if (input.campaignName) parts.push(`campaign -> ${input.campaignName}`);
  return parts.join(" | ") || "bulk queue action";
}

function createBulkBatchId() {
  return `bulk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function canActorAssignInBulk(actor: LeadTimelineActor) {
  const normalizedRole = (actor.role ?? "").trim().replace(/[\s-]+/g, "_").toUpperCase();
  if (
    normalizedRole === "MANAGER" ||
    normalizedRole === "SENIOR_MANAGER" ||
    normalizedRole === "GM" ||
    normalizedRole === "AVP" ||
    normalizedRole === "VP" ||
    normalizedRole === "SALES_HEAD" ||
    normalizedRole === "CBO" ||
    normalizedRole === "CEO"
  ) {
    return true;
  }
  if (normalizedRole === "SUPER_ADMIN" || normalizedRole === "ADMIN") {
    return true;
  }
  return canAssignSalesScope({
    role: actor.role ?? null,
    orgRole: actor.role ?? null,
  });
}

function toIsoOrNull(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === "object" && "seconds" in value && typeof (value as { seconds?: unknown }).seconds === "number") {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildRollbackLeadSnapshot(lead: LeadDoc) {
  return {
    leadId: lead.leadId,
    assignedTo: lead.assignedTo ?? null,
    ownerUid: lead.ownerUid ?? null,
    status: lead.status ?? null,
    nextFollowUp: toIsoOrNull(lead.nextFollowUp),
    nextFollowUpDateKey: lead.nextFollowUpDateKey ?? null,
    source: lead.source ?? null,
    campaignName: lead.campaignName ?? null,
    custodyState: lead.custodyState ?? null,
    custodyReason: lead.custodyReason ?? null,
    transferHistoryCount: lead.transferHistory?.length ?? 0,
  };
}

function buildProjectedRollbackSnapshot(input: {
  lead: LeadDoc;
  action: BulkLeadActionInput;
  transferLead?: LeadDoc | null;
}) {
  const normalizedStatus = normalizeLeadStatus(input.action.status ?? input.lead.status);
  const followUpAt =
    input.action.followUpAt && (
      (input.action.status && (isFollowUpStatus(input.action.status) || isPaymentFollowUpStatus(input.action.status))) ||
      !input.action.status
    )
      ? input.action.followUpAt
      : input.action.status && !isFollowUpStatus(input.action.status) && !isPaymentFollowUpStatus(input.action.status)
        ? null
        : input.transferLead?.nextFollowUp ?? input.lead.nextFollowUp ?? null;
  const ownerUid = input.action.assignTo ?? input.transferLead?.ownerUid ?? input.lead.ownerUid ?? null;
  const assignedTo = input.action.assignTo ?? input.transferLead?.assignedTo ?? input.lead.assignedTo ?? null;

  return {
    leadId: input.lead.leadId,
    assignedTo,
    ownerUid,
    status: normalizedStatus,
    nextFollowUp: toIsoOrNull(followUpAt),
    nextFollowUpDateKey:
      input.action.followUpAt
        ? toDateKey(input.action.followUpAt)
        : input.action.status && !isFollowUpStatus(input.action.status) && !isPaymentFollowUpStatus(input.action.status)
          ? null
          : input.transferLead?.nextFollowUpDateKey ?? input.lead.nextFollowUpDateKey ?? null,
    source: input.action.source ?? input.transferLead?.source ?? input.lead.source ?? null,
    campaignName:
      typeof input.action.campaignName === "string"
        ? input.action.campaignName.trim() || null
        : input.transferLead?.campaignName ?? input.lead.campaignName ?? null,
    custodyState: input.transferLead?.custodyState ?? input.lead.custodyState ?? null,
    custodyReason: input.transferLead?.custodyReason ?? input.lead.custodyReason ?? null,
    transferHistoryCount: input.transferLead?.transferHistory?.length ?? input.lead.transferHistory?.length ?? 0,
  };
}

export async function applyBulkLeadActions(input: BulkLeadActionInput): Promise<BulkLeadActionResult> {
  if (!db) throw new Error("Firebase is not configured");
  if (input.leads.length === 0) {
    return {
      requested: 0,
      updated: 0,
      writeFailures: [],
      batchId: null,
      sideEffectFailures: [],
    };
  }
  const assignToUid = input.assignTo?.trim() || null;
  const transferReason = input.transferReason?.trim() || "";
  if (assignToUid && !transferReason) {
    throw new Error("Transfer reason is required for bulk assignment.");
  }
  if (assignToUid && !canActorAssignInBulk(input.actor)) {
    throw new Error("Only manager-level roles can run bulk lead assignment.");
  }

  const requested = input.leads.length;
  const firestore = db;
  const summary = buildBulkActionSummary({ ...input, assignTo: assignToUid });
  const batchId = createBulkBatchId();
  const bulkLogRef = doc(firestore, "crm_bulk_actions", batchId);

  const writeFailures: BulkLeadActionResult["writeFailures"] = [];
  const sideEffectFailures: BulkLeadActionResult["sideEffectFailures"] = [];

  type SideEffectCandidate = {
    leadId: string;
    originalLead: LeadDoc;
    nextLead: LeadDoc;
  };
  const sideEffectCandidates: SideEffectCandidate[] = [];

  const recordLeadFailure = async (
    leadId: string,
    step: "write_validation" | "write_commit" | "task_sync" | "workflow_sync",
    error: string,
  ) => {
    try {
      const failureRef = doc(collection(firestore, "crm_bulk_actions", batchId, "lead_failures"));
      await setDoc(failureRef, {
        leadId,
        step,
        error,
        createdAt: serverTimestamp(),
      });
    } catch (logError) {
      console.error("Failed to persist bulk lead failure entry", logError);
    }
  };

  const heartbeat = async (patch: Record<string, unknown>) => {
    await setDoc(
      bulkLogRef,
      {
        ...patch,
        lastHeartbeatAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  await setDoc(bulkLogRef, {
    batchId,
    actor: input.actor,
    summary,
    leadCount: requested,
    action: {
      assignTo: assignToUid,
      status: input.status ?? null,
      followUpAt: input.followUpAt ? input.followUpAt.toISOString() : null,
      source: input.source ?? null,
      campaignName: input.campaignName ?? null,
      remarks: input.remarks?.trim() || null,
      transferReason: transferReason || null,
    },
    startedAt: serverTimestamp(),
    state: "running",
    requested,
    updated: 0,
    writeFailureCount: 0,
    writeFailures: [],
    sideEffectFailureCount: 0,
    sideEffectFailures: [],
    rollbackSafe: true,
  });

  let updated = 0;
  let processed = 0;

  try {
    for (const lead of input.leads) {
      let transferLead: LeadDoc | null = null;
      let transferRecord: ReturnType<typeof buildLeadTransferMutation>["transferRecord"] | null = null;
      let nextLead: LeadDoc | null = null;
      let updates: Record<string, unknown> | null = null;

      try {
        const historyEntries = [
          buildLeadHistoryEntry({
            action: "Bulk Queue Action",
            actor: input.actor,
            oldStatus: String(lead.status ?? "unknown"),
            newStatus: String(input.status ?? lead.status ?? "unknown"),
            remarks: input.remarks?.trim() || summary,
          }),
        ];
        updates = {
          updatedAt: serverTimestamp(),
          lastActionBy: input.actor.uid,
          lastActionAt: serverTimestamp(),
        };

        if (assignToUid) {
          const transfer = buildLeadTransferMutation({
            lead,
            actor: input.actor,
            nextOwnerUid: assignToUid,
            reason: transferReason,
          });
          Object.assign(updates, transfer.updates);
          historyEntries.push(transfer.historyEntry);
          transferLead = transfer.nextLead;
          transferRecord = transfer.transferRecord;
        }

        if (input.status) {
          updates.status = input.status;
          updates.statusDetail = {
            currentStage: "Bulk Queue Action",
            currentReason: `Moved to ${getLeadStatusLabel(input.status)}`,
            lastUpdated: new Date(),
            isLocked: false,
            history: [
              ...(lead.statusDetail?.history ?? []),
              {
                stage: "Bulk Queue Action",
                reason: `Moved to ${getLeadStatusLabel(input.status)}`,
                updatedAt: new Date(),
              },
            ],
          };
        }

        if (
          input.followUpAt &&
          ((input.status &&
            (isFollowUpStatus(input.status) || isPaymentFollowUpStatus(input.status))) ||
            !input.status)
        ) {
          updates.nextFollowUp = input.followUpAt;
          updates.nextFollowUpDateKey = toDateKey(input.followUpAt);
        } else if (
          input.status &&
          !isFollowUpStatus(input.status) &&
          !isPaymentFollowUpStatus(input.status)
        ) {
          updates.nextFollowUp = null;
          updates.nextFollowUpDateKey = null;
        }

        if (input.source) updates.source = input.source.trim();
        if (typeof input.campaignName === "string") {
          updates.campaignName = input.campaignName.trim() || null;
        }
        updates.history = arrayUnion(...historyEntries);

        const nextStatus = normalizeLeadStatus(input.status ?? lead.status);
        nextLead = {
          ...lead,
          assignedTo: assignToUid ?? lead.assignedTo ?? lead.ownerUid ?? null,
          ownerUid: assignToUid ?? lead.ownerUid ?? lead.assignedTo ?? null,
          status: nextStatus,
          nextFollowUp: input.followUpAt ?? lead.nextFollowUp ?? null,
          nextFollowUpDateKey: input.followUpAt
            ? toDateKey(input.followUpAt)
            : input.status &&
                !isFollowUpStatus(input.status) &&
                !isPaymentFollowUpStatus(input.status)
              ? null
              : lead.nextFollowUpDateKey ?? null,
          source: input.source ?? lead.source,
          campaignName:
            typeof input.campaignName === "string"
              ? input.campaignName.trim() || null
              : lead.campaignName ?? null,
        };

        if (transferLead) {
          Object.assign(nextLead, transferLead, {
            status: nextStatus,
            nextFollowUp: input.followUpAt ?? transferLead.nextFollowUp ?? null,
            nextFollowUpDateKey: input.followUpAt
              ? toDateKey(input.followUpAt)
              : input.status &&
                  !isFollowUpStatus(input.status) &&
                  !isPaymentFollowUpStatus(input.status)
                ? null
                : transferLead.nextFollowUpDateKey ?? null,
            source: input.source ?? transferLead.source,
            campaignName:
              typeof input.campaignName === "string"
                ? input.campaignName.trim() || null
                : transferLead.campaignName ?? null,
          });
        }
      } catch (error) {
        const message = getErrorMessage(error);
        writeFailures.push({
          leadId: lead.leadId,
          step: "write_validation",
          error: message,
        });
        await recordLeadFailure(lead.leadId, "write_validation", message);
        processed += 1;
        if (processed % 20 === 0 || processed === requested) {
          await heartbeat({
            updated,
            writeFailureCount: writeFailures.length,
          });
        }
        continue;
      }

      try {
        const leadBatch = writeBatch(firestore);
        const leadRef = doc(firestore, "leads", lead.leadId);
        const timelineRef = doc(collection(firestore, "leads", lead.leadId, "timeline"));
        const changeRef = doc(
          firestore,
          "crm_bulk_actions",
          batchId,
          "lead_changes",
          lead.leadId,
        );

        leadBatch.update(leadRef, updates as Record<string, unknown>);
        leadBatch.set(timelineRef, {
          type: assignToUid ? "reassigned" : "bulk_action_applied",
          summary: assignToUid ? "Bulk assignment applied" : "Bulk queue action applied",
          actor: input.actor,
          metadata: {
            batchId,
            assignTo: assignToUid,
            transferReason: transferReason || null,
            transfer: transferRecord,
            status: input.status ?? null,
            followUpAt: input.followUpAt ? input.followUpAt.toISOString() : null,
            source: input.source ?? null,
            campaignName: input.campaignName ?? null,
            remarks: input.remarks?.trim() || null,
          },
          createdAt: serverTimestamp(),
        });
        leadBatch.set(changeRef, {
          leadId: lead.leadId,
          summary,
          transfer: transferRecord,
          before: buildRollbackLeadSnapshot(lead),
          after: buildProjectedRollbackSnapshot({
            lead,
            action: { ...input, assignTo: assignToUid },
            transferLead,
          }),
          rollbackReady: true,
          batchId,
          createdAt: serverTimestamp(),
        });
        await leadBatch.commit();
        updated += 1;

        if (nextLead) {
          sideEffectCandidates.push({
            leadId: lead.leadId,
            originalLead: lead,
            nextLead,
          });
        }
      } catch (error) {
        const message = getErrorMessage(error);
        writeFailures.push({
          leadId: lead.leadId,
          step: "write_commit",
          error: message,
        });
        await recordLeadFailure(lead.leadId, "write_commit", message);
      }

      processed += 1;
      if (processed % 20 === 0 || processed === requested) {
        await heartbeat({
          updated,
          writeFailureCount: writeFailures.length,
        });
      }
    }

    for (const candidate of sideEffectCandidates) {
      if (assignToUid) {
        try {
          await syncLeadLinkedTasks({
            lead: candidate.nextLead,
            actorUid: input.actor.uid,
            reassignOpenTasksTo: assignToUid,
          });
        } catch (error) {
          const message = getErrorMessage(error);
          sideEffectFailures.push({
            leadId: candidate.leadId,
            step: "task_sync",
            error: message,
          });
          await recordLeadFailure(candidate.leadId, "task_sync", message);
        }
      }

      if (input.status || input.followUpAt) {
        try {
          await syncLeadWorkflowAutomation({
            lead: candidate.nextLead,
            actor: input.actor,
            status: normalizeLeadStatus(input.status ?? candidate.originalLead.status),
            followUpDate: input.followUpAt ?? null,
            remarks: input.remarks?.trim() || summary,
            stage: input.status
              ? "Bulk Queue Action"
              : candidate.originalLead.statusDetail?.currentStage ?? null,
            reason: input.status
              ? `Moved to ${getLeadStatusLabel(
                  normalizeLeadStatus(input.status ?? candidate.originalLead.status),
                )}`
              : candidate.originalLead.statusDetail?.currentReason ?? null,
            source: "crm_status_automation",
          });
        } catch (error) {
          const message = getErrorMessage(error);
          sideEffectFailures.push({
            leadId: candidate.leadId,
            step: "workflow_sync",
            error: message,
          });
          await recordLeadFailure(candidate.leadId, "workflow_sync", message);
        }
      }
    }

    await setDoc(
      bulkLogRef,
      {
        state:
          writeFailures.length > 0 || sideEffectFailures.length > 0
            ? "completed_with_issues"
            : "completed",
        completedAt: serverTimestamp(),
        requested,
        updated,
        failedCount: requested - updated,
        rollbackReadyCount: updated,
        writeFailureCount: writeFailures.length,
        writeFailures,
        sideEffectFailureCount: sideEffectFailures.length,
        sideEffectFailures,
      },
      { merge: true },
    );
  } catch (error) {
    const message = getErrorMessage(error);
    try {
      await setDoc(
        bulkLogRef,
        {
          state: "failed",
          failedAt: serverTimestamp(),
          failureMessage: message,
          requested,
          updated,
          failedCount: requested - updated,
          writeFailureCount: writeFailures.length,
          writeFailures,
          sideEffectFailureCount: sideEffectFailures.length,
          sideEffectFailures,
        },
        { merge: true },
      );
    } catch (logError) {
      console.error("Failed to update bulk action failure log", logError);
    }
    throw error;
  }

  return {
    requested,
    updated,
    writeFailures,
    batchId,
    sideEffectFailures,
  };
}
