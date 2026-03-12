import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { buildLeadIdentityFields } from "@/lib/firebase/leads";
import { parseDateValue } from "@/lib/crm/workbench";
import { buildLeadHistoryEntry } from "@/lib/crm/timeline";
import { syncLeadLinkedTasks } from "@/lib/tasks/lead-links";
import { normalizeTaskDoc } from "@/lib/tasks/model";
import { normalizeLeadEmail, normalizeLeadName, normalizeLeadPhone } from "@/lib/crm/dedupe";
import type { LeadDoc, LeadTimelineActor } from "@/lib/types/crm";

export type LeadMergeStrategy = "primary_first" | "recent_non_empty";

export type LeadDuplicateGroup = {
  id: string;
  leads: LeadDoc[];
  reasons: string[];
  score: number;
};

export type LeadMergePreviewField = {
  key:
    | "name"
    | "phone"
    | "email"
    | "currentEducation"
    | "targetDegree"
    | "targetUniversity"
    | "courseFees"
    | "source"
    | "campaignName"
    | "remarks";
  label: string;
  primaryValue: string;
  duplicateValue: string;
  resolvedValue: string;
  conflict: boolean;
};

type PairReason = {
  label: string;
  score: number;
};

type LeadFieldResolverInput = {
  primary: LeadDoc;
  duplicate: LeadDoc;
  strategy: LeadMergeStrategy;
};

const MERGE_PREVIEW_FIELDS: Array<{
  key: LeadMergePreviewField["key"];
  label: string;
}> = [
  { key: "name", label: "Full Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "currentEducation", label: "Education" },
  { key: "targetDegree", label: "Target Degree" },
  { key: "targetUniversity", label: "Target University" },
  { key: "courseFees", label: "Course Fees" },
  { key: "source", label: "Source" },
  { key: "campaignName", label: "Campaign" },
  { key: "remarks", label: "Remarks" },
];

function getLeadRecency(lead: LeadDoc) {
  return (
    parseDateValue(lead.updatedAt)?.getTime() ??
    parseDateValue(lead.lastActionAt)?.getTime() ??
    parseDateValue(lead.createdAt)?.getTime() ??
    0
  );
}

function toDisplayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return String(value);
  return String(value);
}

function normalizeComparable(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

function pickTextValue(
  primaryValue: string | null | undefined,
  duplicateValue: string | null | undefined,
  input: LeadFieldResolverInput,
) {
  const primary = primaryValue?.trim() ?? "";
  const duplicate = duplicateValue?.trim() ?? "";

  if (!primary && !duplicate) return "";
  if (!primary) return duplicate;
  if (!duplicate) return primary;
  if (primary === duplicate) return primary;

  if (input.strategy === "primary_first") return primary;

  return getLeadRecency(input.duplicate) > getLeadRecency(input.primary)
    ? duplicate
    : primary;
}

function pickRemarksValue(input: LeadFieldResolverInput) {
  const primary = input.primary.remarks?.trim() ?? "";
  const duplicate = input.duplicate.remarks?.trim() ?? "";

  if (!primary && !duplicate) return "";
  if (!primary) return duplicate;
  if (!duplicate) return primary;
  if (primary === duplicate) return primary;

  if (input.strategy === "recent_non_empty") {
    return getLeadRecency(input.duplicate) > getLeadRecency(input.primary)
      ? duplicate
      : primary;
  }

  return primary.length >= duplicate.length ? primary : duplicate;
}

function pickNumberValue(
  primaryValue: number | null | undefined,
  duplicateValue: number | null | undefined,
  input: LeadFieldResolverInput,
) {
  if (typeof primaryValue === "number" && typeof duplicateValue === "number") {
    if (primaryValue === duplicateValue) return primaryValue;
    if (input.strategy === "primary_first") return primaryValue;
    return getLeadRecency(input.duplicate) > getLeadRecency(input.primary)
      ? duplicateValue
      : primaryValue;
  }
  if (typeof primaryValue === "number") return primaryValue;
  if (typeof duplicateValue === "number") return duplicateValue;
  return null;
}

function buildPairReasons(left: LeadDoc, right: LeadDoc): PairReason[] {
  const reasons: PairReason[] = [];
  if (
    normalizeLeadPhone(left.phone) &&
    normalizeLeadPhone(left.phone) === normalizeLeadPhone(right.phone)
  ) {
    reasons.push({ label: "Same phone number", score: 100 });
  }
  if (
    normalizeLeadEmail(left.email) &&
    normalizeLeadEmail(left.email) === normalizeLeadEmail(right.email)
  ) {
    reasons.push({ label: "Same email address", score: 90 });
  }
  if (
    normalizeLeadName(left.name) &&
    normalizeLeadName(left.name) === normalizeLeadName(right.name) &&
    normalizeLeadName(left.targetUniversity) &&
    normalizeLeadName(left.targetUniversity) === normalizeLeadName(right.targetUniversity)
  ) {
    reasons.push({ label: "Same lead name and university", score: 60 });
  } else if (
    normalizeLeadName(left.name) &&
    normalizeLeadName(left.name) === normalizeLeadName(right.name)
  ) {
    reasons.push({ label: "Same lead name", score: 45 });
  }
  if (
    normalizeLeadName(left.targetDegree) &&
    normalizeLeadName(left.targetDegree) === normalizeLeadName(right.targetDegree)
  ) {
    reasons.push({ label: "Same target degree", score: 20 });
  }
  return reasons;
}

function buildDuplicateGraph(leads: LeadDoc[]) {
  const adjacency = new Map<string, Set<string>>();
  const reasonMap = new Map<string, PairReason[]>();
  const leadById = new Map(leads.map((lead) => [lead.leadId, lead]));

  for (let index = 0; index < leads.length; index += 1) {
    for (let pointer = index + 1; pointer < leads.length; pointer += 1) {
      const left = leads[index]!;
      const right = leads[pointer]!;
      const reasons = buildPairReasons(left, right);
      if (reasons.length === 0) continue;

      if (!adjacency.has(left.leadId)) adjacency.set(left.leadId, new Set());
      if (!adjacency.has(right.leadId)) adjacency.set(right.leadId, new Set());
      adjacency.get(left.leadId)!.add(right.leadId);
      adjacency.get(right.leadId)!.add(left.leadId);
      reasonMap.set([left.leadId, right.leadId].sort().join("|"), reasons);
    }
  }

  const visited = new Set<string>();
  const groups: LeadDuplicateGroup[] = [];

  for (const lead of leads) {
    if (visited.has(lead.leadId) || !adjacency.has(lead.leadId)) continue;
    const stack = [lead.leadId];
    const ids: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      ids.push(current);
      adjacency.get(current)?.forEach((neighbour) => {
        if (!visited.has(neighbour)) stack.push(neighbour);
      });
    }

    const groupLeads = ids
      .map((id) => leadById.get(id))
      .filter((value): value is LeadDoc => Boolean(value))
      .sort((left, right) => getLeadRecency(right) - getLeadRecency(left));

    const reasonTotals = new Map<string, number>();
    for (let index = 0; index < ids.length; index += 1) {
      for (let pointer = index + 1; pointer < ids.length; pointer += 1) {
        const key = [ids[index], ids[pointer]].sort().join("|");
        const pairReasons = reasonMap.get(key) ?? [];
        pairReasons.forEach((reason) => {
          reasonTotals.set(reason.label, Math.max(reasonTotals.get(reason.label) ?? 0, reason.score));
        });
      }
    }

    const reasons = Array.from(reasonTotals.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([label]) => label);
    const score = Array.from(reasonTotals.values()).reduce((sum, value) => sum + value, 0);

    groups.push({
      id: ids.slice().sort().join("__"),
      leads: groupLeads,
      reasons,
      score,
    });
  }

  return groups.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return getLeadRecency(right.leads[0]!) - getLeadRecency(left.leads[0]!);
  });
}

export function isMergedLead(lead: Pick<LeadDoc, "mergeState"> | null | undefined) {
  return lead?.mergeState === "merged";
}

export function buildDuplicateLeadGroups(leads: LeadDoc[]) {
  return buildDuplicateGraph(leads.filter((lead) => !isMergedLead(lead)));
}

function resolvePreviewField(
  field: LeadMergePreviewField["key"],
  input: LeadFieldResolverInput,
) {
  switch (field) {
    case "courseFees":
      return pickNumberValue(input.primary.courseFees, input.duplicate.courseFees, input);
    case "remarks":
      return pickRemarksValue(input);
    case "campaignName":
      return pickTextValue(input.primary.campaignName, input.duplicate.campaignName, input);
    case "source":
      return pickTextValue(input.primary.source, input.duplicate.source, input);
    case "currentEducation":
      return pickTextValue(input.primary.currentEducation, input.duplicate.currentEducation, input);
    case "targetDegree":
      return pickTextValue(input.primary.targetDegree, input.duplicate.targetDegree, input);
    case "targetUniversity":
      return pickTextValue(input.primary.targetUniversity, input.duplicate.targetUniversity, input);
    case "name":
      return pickTextValue(input.primary.name, input.duplicate.name, input);
    case "phone":
      return pickTextValue(input.primary.phone, input.duplicate.phone, input);
    case "email":
      return pickTextValue(input.primary.email, input.duplicate.email, input);
    default:
      return "";
  }
}

export function buildLeadMergePreview(input: {
  primary: LeadDoc;
  duplicate: LeadDoc;
  strategy: LeadMergeStrategy;
}) {
  const resolverInput: LeadFieldResolverInput = {
    primary: input.primary,
    duplicate: input.duplicate,
    strategy: input.strategy,
  };

  return MERGE_PREVIEW_FIELDS.map((field) => {
    const primaryValue = toDisplayValue(input.primary[field.key]);
    const duplicateValue = toDisplayValue(input.duplicate[field.key]);
    const resolvedValue = toDisplayValue(resolvePreviewField(field.key, resolverInput));
    return {
      key: field.key,
      label: field.label,
      primaryValue,
      duplicateValue,
      resolvedValue,
      conflict:
        primaryValue !== "-" &&
        duplicateValue !== "-" &&
        normalizeComparable(primaryValue) !== normalizeComparable(duplicateValue),
    } satisfies LeadMergePreviewField;
  });
}

function buildMergedLeadPatch(input: {
  primary: LeadDoc;
  duplicate: LeadDoc;
  strategy: LeadMergeStrategy;
  overrides?: Partial<Record<LeadMergePreviewField["key"], string>>;
}) {
  const preview = buildLeadMergePreview(input);
  const nextValues = new Map(
    preview.map((field) => [field.key, input.overrides?.[field.key] ?? field.resolvedValue] as const),
  );
  const ownerUid = input.primary.assignedTo ?? input.primary.ownerUid ?? null;
  const nextFollowUpPrimary = parseDateValue(input.primary.nextFollowUp);
  const nextFollowUpDuplicate = parseDateValue(input.duplicate.nextFollowUp);
  const nextFollowUp =
    nextFollowUpPrimary && nextFollowUpDuplicate
      ? new Date(Math.min(nextFollowUpPrimary.getTime(), nextFollowUpDuplicate.getTime()))
      : nextFollowUpPrimary ?? nextFollowUpDuplicate ?? null;
  const mergedLeadIds = Array.from(
    new Set([
      ...(input.primary.mergedLeadIds ?? []),
      ...(input.duplicate.mergedLeadIds ?? []),
      input.duplicate.leadId,
    ]),
  );

  const name = nextValues.get("name");
  const phone = nextValues.get("phone");
  const email = nextValues.get("email");

  return {
    name: name && name !== "-" ? name : input.primary.name,
    phone: phone && phone !== "-" ? phone : null,
    email: email && email !== "-" ? email : null,
    currentEducation: nextValues.get("currentEducation") !== "-" ? nextValues.get("currentEducation") || null : null,
    targetDegree: nextValues.get("targetDegree") !== "-" ? nextValues.get("targetDegree") || null : null,
    targetUniversity: nextValues.get("targetUniversity") !== "-" ? nextValues.get("targetUniversity") || null : null,
    courseFees:
      nextValues.get("courseFees") && nextValues.get("courseFees") !== "-"
        ? Number(nextValues.get("courseFees"))
        : null,
    source: nextValues.get("source") !== "-" ? nextValues.get("source") || null : null,
    campaignName:
      nextValues.get("campaignName") !== "-"
        ? nextValues.get("campaignName") || null
        : null,
    remarks:
      nextValues.get("remarks") !== "-"
        ? nextValues.get("remarks") || null
        : null,
    nextFollowUp,
    nextFollowUpDateKey: nextFollowUp ? nextFollowUp.toISOString().slice(0, 10) : input.primary.nextFollowUpDateKey ?? input.duplicate.nextFollowUpDateKey ?? null,
    mergedLeadIds,
    mergeState: "active" as const,
    mergedIntoLeadId: null,
    mergedAt: serverTimestamp(),
    mergedBy: input.primary.mergedBy ?? null,
    assignedTo: ownerUid,
    ownerUid,
    ...buildLeadIdentityFields({
      name: name && name !== "-" ? name : input.primary.name,
      phone: phone && phone !== "-" ? phone : null,
      email: email && email !== "-" ? email : null,
    }),
  };
}

export async function mergeLeadIntoPrimary(input: {
  primary: LeadDoc;
  duplicate: LeadDoc;
  actor: LeadTimelineActor;
  strategy: LeadMergeStrategy;
  overrides?: Partial<Record<LeadMergePreviewField["key"], string>>;
}) {
  if (!db) throw new Error("Firebase is not configured");

  const firestore = db;
  const primaryRef = doc(firestore, "leads", input.primary.leadId);
  const duplicateRef = doc(firestore, "leads", input.duplicate.leadId);
  const primaryTimelineRef = doc(collection(firestore, "leads", input.primary.leadId, "timeline"));
  const duplicateTimelineRef = doc(collection(firestore, "leads", input.duplicate.leadId, "timeline"));
  const batch = writeBatch(firestore);
  const mergedPatch = buildMergedLeadPatch(input);
  const primaryOwnerUid = input.primary.assignedTo ?? input.primary.ownerUid ?? null;

  batch.update(primaryRef, {
    ...mergedPatch,
    updatedAt: serverTimestamp(),
    lastActionBy: input.actor.uid,
    lastActionAt: serverTimestamp(),
    history: arrayUnion(
      buildLeadHistoryEntry({
        action: "Duplicate Merge",
        actor: input.actor,
        oldStatus: input.primary.leadId,
        newStatus: input.duplicate.leadId,
        remarks: `Merged duplicate lead ${input.duplicate.leadId} into ${input.primary.leadId}`,
      }),
    ),
  });
  batch.update(duplicateRef, {
    mergeState: "merged",
    mergedIntoLeadId: input.primary.leadId,
    mergedAt: serverTimestamp(),
    mergedBy: input.actor,
    updatedAt: serverTimestamp(),
    lastActionBy: input.actor.uid,
    lastActionAt: serverTimestamp(),
    history: arrayUnion(
      buildLeadHistoryEntry({
        action: "Duplicate Merge",
        actor: input.actor,
        oldStatus: input.duplicate.leadId,
        newStatus: input.primary.leadId,
        remarks: `Merged into lead ${input.primary.leadId}`,
      }),
    ),
  });
  batch.set(primaryTimelineRef, {
    type: "duplicate_merged",
    summary: `Merged duplicate lead ${input.duplicate.leadId}`,
    actor: input.actor,
    metadata: {
      primaryLeadId: input.primary.leadId,
      duplicateLeadId: input.duplicate.leadId,
      strategy: input.strategy,
    },
    createdAt: serverTimestamp(),
  });
  batch.set(duplicateTimelineRef, {
    type: "duplicate_merged",
    summary: `Merged into lead ${input.primary.leadId}`,
    actor: input.actor,
    metadata: {
      primaryLeadId: input.primary.leadId,
      duplicateLeadId: input.duplicate.leadId,
      strategy: input.strategy,
    },
    createdAt: serverTimestamp(),
  });
  await batch.commit();

  const duplicateTasks = await getDocs(
    query(collection(firestore, "tasks"), where("leadId", "==", input.duplicate.leadId), limit(400)),
  );
  if (!duplicateTasks.empty) {
    let taskBatch = writeBatch(firestore);
    let writes = 0;
    for (const taskDoc of duplicateTasks.docs) {
      const task = normalizeTaskDoc(taskDoc.data() as Record<string, unknown>, taskDoc.id);
      const status = typeof task.status === "string" ? task.status : "pending";
      taskBatch.set(
        doc(firestore, "tasks", taskDoc.id),
        {
          leadId: input.primary.leadId,
          leadName: mergedPatch.name,
          leadStatus: input.primary.status,
          leadOwnerUid: primaryOwnerUid,
          ...(primaryOwnerUid && status !== "completed"
            ? {
                assignedTo: primaryOwnerUid,
                assigneeUid: primaryOwnerUid,
                assignedBy: input.actor.uid,
              }
            : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      writes += 1;
      if (writes >= 300) {
        await taskBatch.commit();
        taskBatch = writeBatch(firestore);
        writes = 0;
      }
    }
    if (writes > 0) {
      await taskBatch.commit();
    }
  }

  await syncLeadLinkedTasks({
    lead: {
      ...input.primary,
      ...mergedPatch,
      status: input.primary.status,
    },
    actorUid: input.actor.uid,
    reassignOpenTasksTo: primaryOwnerUid,
  });
}
