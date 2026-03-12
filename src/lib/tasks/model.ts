import type { LeadDoc } from "@/lib/types/crm";

export type TaskLeadReference = Pick<LeadDoc, "leadId" | "name" | "status" | "assignedTo" | "ownerUid">;
export type TaskLeadIntegrityState = "unlinked" | "linked" | "orphaned" | "owner_mismatch";

type TaskIdentityFields = {
  id?: string | null;
  assignedTo?: string | null;
  assigneeUid?: string | null;
  assignedBy?: string | null;
  createdBy?: string | null;
  leadId?: string | null;
  leadName?: string | null;
  leadStatus?: string | null;
  leadOwnerUid?: string | null;
};

function normalizeString(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function getTaskAssignee(task: TaskIdentityFields) {
  return task.assignedTo ?? task.assigneeUid ?? null;
}

export function getTaskCreator(task: TaskIdentityFields) {
  return task.createdBy ?? task.assignedBy ?? null;
}

export function getTaskLeadId(task: TaskIdentityFields) {
  return normalizeString(task.leadId);
}

export function getTaskLeadOwnerUid(task: TaskIdentityFields) {
  return normalizeString(task.leadOwnerUid);
}

export function buildTaskLeadWriteFields(input: { lead: TaskLeadReference }) {
  return {
    leadId: normalizeString(input.lead.leadId),
    leadName: normalizeString(input.lead.name),
    leadStatus: normalizeString(String(input.lead.status ?? "")),
    leadOwnerUid: normalizeString(input.lead.assignedTo ?? input.lead.ownerUid ?? null),
  };
}

export function buildTaskLeadSyncPatch(
  task: TaskIdentityFields,
  lead: TaskLeadReference,
) {
  const next = buildTaskLeadWriteFields({ lead });
  const patch: Record<string, string | null> = {};

  if (getTaskLeadId(task) !== next.leadId) patch.leadId = next.leadId;
  if (normalizeString(task.leadName) !== next.leadName) patch.leadName = next.leadName;
  if (normalizeString(task.leadStatus) !== next.leadStatus) patch.leadStatus = next.leadStatus;
  if (getTaskLeadOwnerUid(task) !== next.leadOwnerUid) patch.leadOwnerUid = next.leadOwnerUid;

  return patch;
}

export function getTaskLeadIntegrity(
  task: TaskIdentityFields,
  lead?: TaskLeadReference | null,
): TaskLeadIntegrityState {
  const leadId = getTaskLeadId(task);
  if (!leadId) return "unlinked";
  if (lead === null) return "orphaned";
  if (!lead) return "linked";

  const leadOwnerUid = normalizeString(lead.assignedTo ?? lead.ownerUid ?? null);
  const assigneeUid = getTaskAssignee(task);
  if (leadOwnerUid && assigneeUid && assigneeUid !== leadOwnerUid) {
    return "owner_mismatch";
  }

  return "linked";
}

export function normalizeTaskDoc<T extends Record<string, unknown>>(
  task: T,
  fallbackId?: string,
) {
  const assignedTo = getTaskAssignee(task);
  const createdBy = getTaskCreator(task);
  const leadId = getTaskLeadId(task);
  const id =
    typeof task.id === "string" && task.id.trim()
      ? task.id
      : fallbackId ?? "";

  return {
    ...task,
    id,
    assignedTo,
    assigneeUid: assignedTo,
    assignedBy: createdBy,
    createdBy,
    leadId,
    leadName: normalizeString(task.leadName),
    leadStatus: normalizeString(task.leadStatus),
    leadOwnerUid: getTaskLeadOwnerUid(task),
  };
}

export function buildTaskWriteFields(input: {
  assigneeUid: string;
  creatorUid: string;
}) {
  return {
    assignedTo: input.assigneeUid,
    assigneeUid: input.assigneeUid,
    assignedBy: input.creatorUid,
    createdBy: input.creatorUid,
  };
}
