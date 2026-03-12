"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { getTodayKey } from "@/lib/firebase/attendance";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  InboxIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import Pagination from "@/components/ui/Pagination";
import LeadDistributorWidget from "@/components/team/LeadDistributorWidget";
import { buildTaskWriteFields } from "@/lib/tasks/model";
import { useTeamManagementScope } from "@/lib/hooks/useTeamManagementScope";
import type { LeadDoc, LeadStatus } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";
import { canManageTeam } from "@/lib/access";
import { getBulkCrmRoutingAssignments } from "@/lib/crm/automation-client";
import {
  buildManagerCockpit,
  getLeadStageLabel,
  normalizeCockpitTask,
  type CockpitLeadQueueEntry,
  type CockpitRepWorkload,
  type CockpitTaskDoc,
} from "@/lib/team/cockpit";
import { applyBulkLeadActions } from "@/lib/crm/bulk-actions";
import { getAssignableLeadOwners } from "@/lib/crm/access";
import {
  buildLeadAssignmentPreview,
  transferLeadCustody,
  type LeadAssignmentBucket,
} from "@/lib/crm/custody";
import { buildLeadActor } from "@/lib/crm/timeline";
import { getLeadStatusLabel } from "@/lib/leads/status";

const LISTENER_CHUNK_SIZE = 10;
const LISTENER_LIMIT = 400;

type PresenceRow = {
  uid: string;
  status: "checked_in" | "checked_out" | "on_leave";
  checkedInAt: Timestamp | Date | string | number | null;
  checkedOutAt: Timestamp | Date | string | number | null;
};

type LeadRow = {
  id: string;
  ownerUid: string | null;
  assignedTo: string | null;
  status: string;
  statusDetail?: { currentStage?: string } | null;
  name: string;
};

type TaskDoc = {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  assignedBy: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
  createdAt: unknown;
  completedAt: unknown | null;
  deadline?: unknown | null;
};

type BulkExecutionLogRow = {
  id: string;
  batchId: string;
  state: string;
  summary: string | null;
  requested: number;
  updated: number;
  writeFailureCount: number;
  sideEffectFailureCount: number;
  failedCount: number;
  startedAt: unknown;
  completedAt: unknown;
  failureMessage: string | null;
};

type BulkLeadFailureRow = {
  id: string;
  leadId: string;
  step: string;
  error: string;
  createdAt: unknown;
};

type BulkLeadChangeRow = {
  id: string;
  leadId: string;
  summary: string | null;
  beforeOwner: string | null;
  afterOwner: string | null;
  beforeStatus: string | null;
  afterStatus: string | null;
  createdAt: unknown;
};

type BulkExecutionDetailsState = {
  loading: boolean;
  error: string | null;
  failures: BulkLeadFailureRow[];
  changes: BulkLeadChangeRow[];
};

function toDate(ts: unknown) {
  if (!ts) return null;
  return (ts as Timestamp).toDate
    ? (ts as Timestamp).toDate()
    : new Date(ts as Date | string | number);
}

function hoursBetween(
  a: Timestamp | Date | string | number | null | undefined,
  b: Timestamp | Date | string | number | null | undefined,
) {
  const ad = toDate(a);
  const bd = toDate(b);
  if (!ad || !bd) return 0;
  const ms = Math.max(0, bd.getTime() - ad.getTime());
  return Math.round((ms / (1000 * 60 * 60)) * 10) / 10;
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function chunk<T>(values: T[], size: number) {
  const buckets: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    buckets.push(values.slice(index, index + size));
  }
  return buckets;
}

function getRepLabel(user: Pick<UserDoc, "uid" | "displayName" | "name" | "email">) {
  return user.displayName ?? user.name ?? user.email ?? user.uid;
}

function getLeadOwnerUid(lead: Pick<LeadDoc, "assignedTo" | "ownerUid">) {
  return lead.assignedTo ?? lead.ownerUid ?? null;
}

function getPresenceTone(status: PresenceRow["status"] | undefined) {
  if (status === "checked_in") return "bg-emerald-500";
  if (status === "on_leave") return "bg-amber-500";
  return "bg-slate-400";
}

function getWorkloadTone(rep: CockpitRepWorkload) {
  if (rep.status === "overloaded") {
    return {
      card: "border-rose-200 bg-rose-50/70",
      badge: "bg-rose-100 text-rose-700",
      bar: "bg-rose-500",
      label: "Overloaded",
    };
  }
  if (rep.status === "available") {
    return {
      card: "border-emerald-200 bg-emerald-50/70",
      badge: "bg-emerald-100 text-emerald-700",
      bar: "bg-emerald-500",
      label: "Available",
    };
  }
  return {
    card: "border-amber-200 bg-amber-50/60",
    badge: "bg-amber-100 text-amber-700",
    bar: "bg-amber-500",
    label: "Balanced",
  };
}

function getQueueTone(entry: CockpitLeadQueueEntry) {
  if (entry.statusTone === "critical") {
    return "border-rose-200 bg-rose-50/80 text-rose-700";
  }
  if (entry.statusTone === "success") {
    return "border-emerald-200 bg-emerald-50/80 text-emerald-700";
  }
  return "border-amber-200 bg-amber-50/80 text-amber-700";
}

function filterQueueRows(
  rows: CockpitLeadQueueEntry[],
  {
    searchTerm,
    statusFilter,
    ownerFilter,
  }: { searchTerm: string; statusFilter: string; ownerFilter: string },
) {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  return rows.filter((entry) => {
    const lead = entry.lead;
    const ownerUid = getLeadOwnerUid(lead);
    const matchesOwner =
      ownerFilter === "all" ||
      (ownerFilter === "pool" ? !ownerUid : ownerUid === ownerFilter);
    if (!matchesOwner) return false;

    const normalizedStatus = String(lead.status ?? "").trim().toLowerCase();
    const matchesStatus =
      statusFilter === "all" || normalizedStatus === statusFilter.toLowerCase();
    if (!matchesStatus) return false;

    if (!normalizedSearch) return true;
    return [
      lead.leadId,
      lead.name,
      lead.phone,
      lead.email,
      lead.source,
      lead.campaignName,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch));
  });
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeBulkExecutionLogRow(id: string, value: Record<string, unknown>): BulkExecutionLogRow {
  return {
    id,
    batchId: String(value.batchId ?? id),
    state: String(value.state ?? "unknown"),
    summary: typeof value.summary === "string" ? value.summary : null,
    requested: toNumber(value.requested ?? value.leadCount),
    updated: toNumber(value.updated),
    writeFailureCount: toNumber(value.writeFailureCount),
    sideEffectFailureCount: toNumber(value.sideEffectFailureCount),
    failedCount: toNumber(value.failedCount),
    startedAt: value.startedAt ?? null,
    completedAt: value.completedAt ?? value.failedAt ?? null,
    failureMessage: typeof value.failureMessage === "string" ? value.failureMessage : null,
  };
}

function normalizeBulkLeadFailureRow(id: string, value: Record<string, unknown>): BulkLeadFailureRow {
  return {
    id,
    leadId: typeof value.leadId === "string" ? value.leadId : "-",
    step: typeof value.step === "string" ? value.step : "unknown",
    error: typeof value.error === "string" ? value.error : "Unknown error",
    createdAt: value.createdAt ?? null,
  };
}

function normalizeBulkLeadChangeRow(id: string, value: Record<string, unknown>): BulkLeadChangeRow {
  const before = (value.before ?? {}) as Record<string, unknown>;
  const after = (value.after ?? {}) as Record<string, unknown>;
  return {
    id,
    leadId: typeof value.leadId === "string" ? value.leadId : id,
    summary: typeof value.summary === "string" ? value.summary : null,
    beforeOwner: typeof before.ownerUid === "string" ? before.ownerUid : null,
    afterOwner: typeof after.ownerUid === "string" ? after.ownerUid : null,
    beforeStatus: typeof before.status === "string" ? before.status : null,
    afterStatus: typeof after.status === "string" ? after.status : null,
    createdAt: value.createdAt ?? null,
  };
}

function getBulkExecutionStateTone(state: string) {
  if (state === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (state === "running") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (state === "completed_with_issues") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (state === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function QueuePanel(props: {
  title: string;
  subtitle: string;
  rows: CockpitLeadQueueEntry[];
  emptyTitle: string;
  emptyMessage: string;
  subordinates: UserDoc[];
  suggestedAssigneeUid?: string | null;
  onAssign: (lead: LeadDoc, assigneeUid: string) => Promise<void>;
  busyLeadId: string | null;
  selectedLeadIds: Set<string>;
  onToggleLead: (leadId: string) => void;
  onToggleVisible: (leadIds: string[]) => void;
  visibleLimit: number;
}) {
  const {
    title,
    subtitle,
    rows,
    emptyTitle,
    emptyMessage,
    subordinates,
    suggestedAssigneeUid,
    onAssign,
    busyLeadId,
    selectedLeadIds,
    onToggleLead,
    onToggleVisible,
    visibleLimit,
  } = props;
  const suggestedAssignee =
    suggestedAssigneeUid && subordinates.some((user) => user.uid === suggestedAssigneeUid)
      ? subordinates.find((user) => user.uid === suggestedAssigneeUid) ?? null
      : null;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                onToggleVisible(
                  rows.slice(0, visibleLimit).map((entry) => entry.lead.leadId),
                )
              }
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              Select visible
            </button>
          ) : null}
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {rows.length}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {rows.slice(0, visibleLimit).map((entry) => {
          const lead = entry.lead;
          const ownerUid = lead.assignedTo ?? lead.ownerUid ?? null;
          const canSuggest = suggestedAssignee && suggestedAssignee.uid !== ownerUid;
          return (
            <div key={lead.leadId} className="rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <label className="mt-0.5 inline-flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedLeadIds.has(lead.leadId)}
                      onChange={() => onToggleLead(lead.leadId)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </label>
                  <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {lead.name || "Unnamed lead"}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    #{lead.leadId.slice(-6)} | {getLeadStageLabel(lead)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>
                      {entry.owner ? `Owner: ${getRepLabel(entry.owner)}` : "Owner not set"}
                    </span>
                    {lead.phone ? <span>{lead.phone}</span> : null}
                  </div>
                </div>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${getQueueTone(entry)}`}
                >
                  {entry.label}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {canSuggest && suggestedAssignee ? (
                  <button
                    type="button"
                    onClick={() => void onAssign(lead, suggestedAssignee.uid)}
                    disabled={busyLeadId === lead.leadId}
                    className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busyLeadId === lead.leadId
                      ? "Moving..."
                      : `Move to ${getRepLabel(suggestedAssignee)}`}
                  </button>
                ) : null}
                <select
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                  defaultValue=""
                  onChange={(event) => {
                    const nextUid = event.target.value;
                    event.target.value = "";
                    if (!nextUid) return;
                    void onAssign(lead, nextUid);
                  }}
                  disabled={busyLeadId === lead.leadId}
                >
                  <option value="">Reassign...</option>
                  {subordinates
                    .filter((user) => user.uid !== ownerUid)
                    .map((user) => (
                      <option key={user.uid} value={user.uid}>
                        {getRepLabel(user)}
                      </option>
                    ))}
                </select>
                <span className="text-[11px] text-slate-500">{entry.actionLabel}</span>
              </div>
            </div>
          );
        })}

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-center">
            <div className="text-sm font-semibold text-slate-900">{emptyTitle}</div>
            <div className="mt-1 text-xs text-slate-500">{emptyMessage}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function TeamManagementPage() {
  const { firebaseUser, userDoc } = useAuth();
  const uid = firebaseUser?.uid ?? null;
  const todayKey = useMemo(() => getTodayKey(), []);
  const { scopedUsers: subordinates, loading: subordinatesLoading } = useTeamManagementScope(
    userDoc ?? null,
  );
  const assignmentUsers = useMemo(
    () =>
      getAssignableLeadOwners(
        userDoc ?? null,
        [...subordinates, ...(userDoc ? [userDoc] : [])],
      ),
    [subordinates, userDoc],
  );
  const actor = useMemo(
    () =>
      userDoc
        ? buildLeadActor({
            uid: userDoc.uid,
            displayName: userDoc.displayName,
            email: userDoc.email,
            role: userDoc.role,
            orgRole: userDoc.orgRole,
            employeeId: userDoc.employeeId ?? null,
          })
        : null,
    [userDoc],
  );

  const [presenceByUid, setPresenceByUid] = useState<Record<string, PresenceRow>>({});
  const [pipelineStats, setPipelineStats] = useState<
    Record<string, { pitch: number; followUp: number; enrolled: number }>
  >({});
  const [unassignedLeads, setUnassignedLeads] = useState<LeadRow[]>([]);
  const [approvalLeads, setApprovalLeads] = useState<LeadRow[]>([]);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<{
    title: string;
    description: string;
    assigneeUid: string;
    priority: "high" | "medium" | "low";
    deadline: string | null;
  }>({
    title: "",
    description: "",
    assigneeUid: "",
    priority: "medium",
    deadline: null,
  });
  const [unassignedPage, setUnassignedPage] = useState(1);
  const [approvalPage, setApprovalPage] = useState(1);
  const [scopedLeads, setScopedLeads] = useState<LeadDoc[]>([]);
  const [scopedTasks, setScopedTasks] = useState<CockpitTaskDoc[]>([]);
  const [reassigningLeadId, setReassigningLeadId] = useState<string | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [queueSearchTerm, setQueueSearchTerm] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] = useState<string>("all");
  const [queueOwnerFilter, setQueueOwnerFilter] = useState<string>("all");
  const [queueVisibleLimit, setQueueVisibleLimit] = useState<number>(6);
  const [candidateSelectedLeadIds, setCandidateSelectedLeadIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState({
    selectionMode: "selected" as "selected" | "count",
    distributionMode: "direct" as "direct" | "team_auto_route",
    count: "25",
    bucket: "stale" as LeadAssignmentBucket,
    filterSource: "",
    filterCampaignName: "",
    filterStatus: "",
    assignTo: "",
    status: "",
    followUpAt: "",
    source: "",
    campaignName: "",
    remarks: "",
    transferReason: "",
    routingOverrideUid: "",
  });
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [routePreview, setRoutePreview] = useState<{
    loading: boolean;
    rows: Array<{ uid: string; label: string; count: number }>;
  }>({ loading: false, rows: [] });
  const [bulkExecutionLogs, setBulkExecutionLogs] = useState<BulkExecutionLogRow[]>([]);
  const [bulkExecutionLoading, setBulkExecutionLoading] = useState(true);
  const [bulkExecutionError, setBulkExecutionError] = useState<string | null>(null);
  const [expandedBulkBatchId, setExpandedBulkBatchId] = useState<string | null>(null);
  const [bulkExecutionDetailsByBatch, setBulkExecutionDetailsByBatch] = useState<
    Record<string, BulkExecutionDetailsState>
  >({});

  const unassignedPerPage = 5;
  const approvalPerPage = 5;
  const subordinateIds = useMemo(() => subordinates.map((user) => user.uid), [subordinates]);
  const subordinateIdKey = useMemo(() => subordinateIds.join("|"), [subordinateIds]);
  const scopedLeadMap = useMemo(
    () => new Map(scopedLeads.map((lead) => [lead.leadId, lead] as const)),
    [scopedLeads],
  );
  const assignmentPreview = useMemo(
    () =>
      buildLeadAssignmentPreview({
        leads: scopedLeads,
        selectedLeadIds:
          bulkAction.selectionMode === "selected"
            ? selectedLeadIds
            : candidateSelectedLeadIds,
        mode: bulkAction.selectionMode,
        count: Number(bulkAction.count) || 0,
        bucket: bulkAction.bucket,
        source: bulkAction.filterSource || null,
        campaignName: bulkAction.filterCampaignName || null,
        status: bulkAction.filterStatus || null,
      }),
    [
      bulkAction.bucket,
      bulkAction.count,
      bulkAction.filterCampaignName,
      bulkAction.filterSource,
      bulkAction.filterStatus,
      bulkAction.selectionMode,
      candidateSelectedLeadIds,
      scopedLeads,
      selectedLeadIds,
    ],
  );
  const previewLeadIdsKey = useMemo(
    () => assignmentPreview.leads.map((lead) => lead.leadId).join("|"),
    [assignmentPreview.leads],
  );
  const bulkPreviewDiff = useMemo(() => {
    const leads = assignmentPreview.leads;
    const followUpTarget = bulkAction.followUpAt ? new Date(bulkAction.followUpAt) : null;
    const ownerChanges = bulkAction.assignTo
      ? leads.filter((lead) => (lead.ownerUid ?? lead.assignedTo ?? null) !== bulkAction.assignTo).length
      : 0;
    const statusChanges = bulkAction.status
      ? leads.filter((lead) => String(lead.status ?? "") !== bulkAction.status).length
      : 0;
    const followUpChanges = followUpTarget
      ? leads.filter((lead) => (lead.nextFollowUpDateKey ?? null) !== toDateKey(followUpTarget)).length
      : 0;
    const sourceChanges = bulkAction.source.trim()
      ? leads.filter((lead) => (lead.source ?? "").trim() !== bulkAction.source.trim()).length
      : 0;
    const campaignChanges = bulkAction.campaignName.trim()
      ? leads.filter((lead) => (lead.campaignName ?? "").trim() !== bulkAction.campaignName.trim()).length
      : 0;

    return {
      ownerChanges,
      statusChanges,
      followUpChanges,
      sourceChanges,
      campaignChanges,
    };
  }, [
    assignmentPreview.leads,
    bulkAction.assignTo,
    bulkAction.campaignName,
    bulkAction.followUpAt,
    bulkAction.source,
    bulkAction.status,
  ]);
  const ownerLabelByUid = useMemo(() => {
    const map = new Map<string, string>();
    const candidates = [...assignmentUsers, ...(userDoc ? [userDoc] : [])];
    candidates.forEach((user) => map.set(user.uid, getRepLabel(user)));
    return map;
  }, [assignmentUsers, userDoc]);
  const bulkPreviewRows = useMemo(() => {
    const followUpTarget = bulkAction.followUpAt ? toDateKey(new Date(bulkAction.followUpAt)) : null;
    const sourceTarget = bulkAction.source.trim() || null;
    const campaignTarget = bulkAction.campaignName.trim() || null;

    return assignmentPreview.leads
      .map((lead) => {
        const beforeOwnerUid = getLeadOwnerUid(lead);
        const beforeStatus = String(lead.status ?? "").trim() || "-";
        const beforeFollowUp = lead.nextFollowUpDateKey ?? "-";
        const beforeSource = (lead.source ?? "").trim() || "-";
        const beforeCampaign = (lead.campaignName ?? "").trim() || "-";

        const afterOwnerUid = bulkAction.assignTo || beforeOwnerUid;
        const afterStatus = bulkAction.status || beforeStatus;
        const afterFollowUp = followUpTarget ?? beforeFollowUp;
        const afterSource = sourceTarget ?? beforeSource;
        const afterCampaign = campaignTarget ?? beforeCampaign;

        const changedFields: string[] = [];
        if ((beforeOwnerUid ?? null) !== (afterOwnerUid ?? null)) changedFields.push("Owner");
        if (beforeStatus !== afterStatus) changedFields.push("Status");
        if (beforeFollowUp !== afterFollowUp) changedFields.push("Follow-up");
        if (beforeSource !== afterSource) changedFields.push("Source");
        if (beforeCampaign !== afterCampaign) changedFields.push("Campaign");

        if (changedFields.length === 0) return null;

        return {
          leadId: lead.leadId,
          name: lead.name || "Unnamed lead",
          changedFields,
          before: {
            owner: beforeOwnerUid ? ownerLabelByUid.get(beforeOwnerUid) ?? beforeOwnerUid : "Pool",
            status: getLeadStatusLabel(beforeStatus),
            followUp: beforeFollowUp,
            source: beforeSource,
            campaign: beforeCampaign,
          },
          after: {
            owner: afterOwnerUid ? ownerLabelByUid.get(afterOwnerUid) ?? afterOwnerUid : "Pool",
            status: getLeadStatusLabel(afterStatus),
            followUp: afterFollowUp,
            source: afterSource,
            campaign: afterCampaign,
          },
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [
    assignmentPreview.leads,
    bulkAction.assignTo,
    bulkAction.campaignName,
    bulkAction.followUpAt,
    bulkAction.source,
    bulkAction.status,
    ownerLabelByUid,
  ]);

  const paginatedUnassignedLeads = useMemo(() => {
    const start = (unassignedPage - 1) * unassignedPerPage;
    return unassignedLeads.slice(start, start + unassignedPerPage);
  }, [unassignedLeads, unassignedPage]);

  useEffect(() => {
    const maxPage = Math.ceil(unassignedLeads.length / unassignedPerPage) || 1;
    if (unassignedPage > maxPage) setUnassignedPage(maxPage);
  }, [unassignedLeads.length, unassignedPage]);

  const paginatedApprovalLeads = useMemo(() => {
    const start = (approvalPage - 1) * approvalPerPage;
    return approvalLeads.slice(start, start + approvalPerPage);
  }, [approvalLeads, approvalPage]);

  useEffect(() => {
    const maxPage = Math.ceil(approvalLeads.length / approvalPerPage) || 1;
    if (approvalPage > maxPage) setApprovalPage(maxPage);
  }, [approvalLeads.length, approvalPage]);

  useEffect(() => {
    setSelectedLeadIds((current) => current.filter((leadId) => scopedLeadMap.has(leadId)));
  }, [scopedLeadMap]);

  useEffect(() => {
    if (bulkAction.selectionMode !== "count") return;
    const candidateLeadIds = new Set(assignmentPreview.candidateLeads.map((lead) => lead.leadId));
    setCandidateSelectedLeadIds((current) =>
      current.filter((leadId) => candidateLeadIds.has(leadId)),
    );
  }, [assignmentPreview.candidateLeads, bulkAction.selectionMode]);

  useEffect(() => {
    if (bulkAction.distributionMode !== "team_auto_route" || !bulkAction.assignTo || assignmentPreview.leads.length === 0) {
      setRoutePreview({ loading: false, rows: [] });
      return;
    }

    let active = true;
    setRoutePreview({ loading: true, rows: [] });
    getBulkCrmRoutingAssignments(
      bulkAction.assignTo,
      assignmentPreview.leads.map((lead) => lead.leadId),
      { overrideAssigneeUid: bulkAction.routingOverrideUid || null },
    )
      .then((plan) => {
        if (!active) return;
        const counts = new Map<string, number>();
        assignmentPreview.leads.forEach((lead) => {
          const ownerUid = plan.get(lead.leadId) ?? bulkAction.assignTo;
          counts.set(ownerUid, (counts.get(ownerUid) ?? 0) + 1);
        });
        const rows = Array.from(counts.entries())
          .map(([uid, count]) => {
            const user = assignmentUsers.find((candidate) => candidate.uid === uid);
            return {
              uid,
              label: getRepLabel(user ?? { uid, displayName: uid, name: uid, email: uid }),
              count,
            };
          })
          .sort((left, right) => right.count - left.count);
        setRoutePreview({ loading: false, rows });
      })
      .catch((error) => {
        console.error("Assignment preview routing failed", error);
        if (active) setRoutePreview({ loading: false, rows: [] });
      });

    return () => {
      active = false;
    };
  }, [assignmentPreview.leads, assignmentUsers, bulkAction.assignTo, bulkAction.distributionMode, bulkAction.routingOverrideUid, previewLeadIdsKey]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !canManageTeam(userDoc)) {
      setBulkExecutionLogs([]);
      setBulkExecutionLoading(false);
      setBulkExecutionError(null);
      setExpandedBulkBatchId(null);
      setBulkExecutionDetailsByBatch({});
      return;
    }

    setBulkExecutionLoading(true);
    setBulkExecutionError(null);
    return onSnapshot(
      query(collection(firestore, "crm_bulk_actions"), orderBy("startedAt", "desc"), limit(8)),
      (snapshot) => {
        const rows = snapshot.docs.map((row) =>
          normalizeBulkExecutionLogRow(row.id, row.data() as Record<string, unknown>),
        );
        setBulkExecutionLogs(rows);
        setBulkExecutionLoading(false);
      },
      (error) => {
        if ((error as { code?: string }).code === "permission-denied") {
          setBulkExecutionLogs([]);
          setBulkExecutionLoading(false);
          setBulkExecutionError(null);
          return;
        }
        setBulkExecutionLoading(false);
        setBulkExecutionError(error instanceof Error ? error.message : "Unable to load bulk execution logs.");
      },
    );
  }, [userDoc]);

  useEffect(() => {
    if (!expandedBulkBatchId) return;
    if (bulkExecutionLogs.some((log) => log.batchId === expandedBulkBatchId)) return;
    setExpandedBulkBatchId(null);
  }, [bulkExecutionLogs, expandedBulkBatchId]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !expandedBulkBatchId || !canManageTeam(userDoc)) return;

    let latestFailures: BulkLeadFailureRow[] = [];
    let latestChanges: BulkLeadChangeRow[] = [];
    const commit = (patch?: Partial<BulkExecutionDetailsState>) => {
      setBulkExecutionDetailsByBatch((current) => ({
        ...current,
        [expandedBulkBatchId]: {
          ...(current[expandedBulkBatchId] ?? {}),
          failures: latestFailures,
          changes: latestChanges,
          loading: false,
          error: null,
          ...(patch ?? {}),
        },
      }));
    };

    setBulkExecutionDetailsByBatch((current) => ({
      ...current,
      [expandedBulkBatchId]: {
        loading: true,
        error: null,
        failures: current[expandedBulkBatchId]?.failures ?? [],
        changes: current[expandedBulkBatchId]?.changes ?? [],
      },
    }));

    const failuresRef = collection(firestore, "crm_bulk_actions", expandedBulkBatchId, "lead_failures");
    const changesRef = collection(firestore, "crm_bulk_actions", expandedBulkBatchId, "lead_changes");

    const failureUnsub = onSnapshot(
      query(failuresRef, orderBy("createdAt", "desc"), limit(40)),
      (snapshot) => {
        latestFailures = snapshot.docs.map((row) =>
          normalizeBulkLeadFailureRow(row.id, row.data() as Record<string, unknown>),
        );
        commit();
      },
      (error) => {
        if ((error as { code?: string }).code === "permission-denied") {
          commit({ loading: false, error: "You do not have permission to read lead failures for this batch." });
          return;
        }
        commit({
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load lead failures for this batch.",
        });
      },
    );

    const changesUnsub = onSnapshot(
      query(changesRef, orderBy("createdAt", "desc"), limit(60)),
      (snapshot) => {
        latestChanges = snapshot.docs.map((row) =>
          normalizeBulkLeadChangeRow(row.id, row.data() as Record<string, unknown>),
        );
        commit();
      },
      (error) => {
        if ((error as { code?: string }).code === "permission-denied") {
          commit({ loading: false, error: "You do not have permission to read lead changes for this batch." });
          return;
        }
        commit({
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load lead changes for this batch.",
        });
      },
    );

    return () => {
      failureUnsub();
      changesUnsub();
    };
  }, [expandedBulkBatchId, userDoc]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || subordinateIds.length === 0) {
      setPresenceByUid({});
      return;
    }

    const unsubs = subordinateIds.map((subordinateUid) =>
      onSnapshot(
        doc(firestore, "presence", subordinateUid),
        (snap) => {
          const data = snap.data() as PresenceRow | undefined;
          setPresenceByUid((prev) => ({
            ...prev,
            [subordinateUid]: data
              ? { ...data, uid: subordinateUid }
              : {
                  uid: subordinateUid,
                  status: "checked_out",
                  checkedInAt: null,
                  checkedOutAt: null,
                },
          }));
        },
        (error) => {
          console.error("Team presence listener error", error);
        },
      ),
    );

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [subordinateIdKey, subordinateIds]);

  useEffect(() => {
    let mounted = true;

    async function fetchStats() {
      if (!firebaseUser) return;
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch("/api/team/pipeline-stats", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && mounted) {
          const data = await res.json();
          setPipelineStats(data.stats ?? {});
        }
      } catch (error) {
        console.error("Failed to fetch pipeline stats", error);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [firebaseUser]);

  useEffect(() => {
    let mounted = true;
    const hasAccess = canManageTeam(userDoc);

    async function fetchUnassigned() {
      if (!firebaseUser || !hasAccess) return;
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch("/api/team/unassigned-leads", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && mounted) {
          const data = await res.json();
          setUnassignedLeads(data.leads ?? []);
        }
      } catch (error) {
        console.error("Failed to fetch unassigned leads", error);
      }
    }

    if (hasAccess) {
      fetchUnassigned();
      const interval = setInterval(fetchUnassigned, 60000);
      return () => {
        mounted = false;
        clearInterval(interval);
      };
    }
  }, [firebaseUser, userDoc]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || subordinateIds.length === 0) {
      setApprovalLeads([]);
      return;
    }

    const bucket = new Map<string, LeadRow>();
    const unsubs = chunk(subordinateIds, LISTENER_CHUNK_SIZE).map((part, index) =>
      onSnapshot(
        query(
          collection(firestore, "leads"),
          where("ownerUid", "in", part),
          where("statusDetail.currentStage", "==", "Enrollment Generated"),
          limit(LISTENER_LIMIT),
        ),
        (snap) => {
          const prefix = `approval-${index}`;
          Array.from(bucket.keys())
            .filter((key) => key.startsWith(prefix))
            .forEach((key) => bucket.delete(key));

          snap.docs.forEach((leadSnap) => {
            const raw = leadSnap.data() as Partial<LeadDoc>;
            bucket.set(`${prefix}-${leadSnap.id}`, {
              id: raw.leadId ?? leadSnap.id,
              ownerUid: raw.ownerUid ?? null,
              assignedTo: raw.assignedTo ?? null,
              status: raw.status ?? "new",
              statusDetail: raw.statusDetail ?? null,
              name: raw.name ?? "-",
            });
          });

          setApprovalLeads(Array.from(bucket.values()));
        },
        (error) => {
          if ((error as { code?: string }).code === "permission-denied") return;
          console.error("Team approvals listener error", error);
        },
      ),
    );

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [subordinateIdKey, subordinateIds]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || subordinateIds.length === 0) {
      setScopedLeads([]);
      return;
    }

    const buckets = new Map<string, Map<string, LeadDoc>>();
    const sync = () => {
      const merged = new Map<string, LeadDoc>();
      buckets.forEach((group) => {
        group.forEach((lead, leadId) => merged.set(leadId, lead));
      });
      setScopedLeads(Array.from(merged.values()));
    };

    const subscribe = (key: string, field: "ownerUid" | "assignedTo", values: string[]) =>
      onSnapshot(
        query(
          collection(firestore, "leads"),
          where(field, "in", values),
          limit(LISTENER_LIMIT),
        ),
        (snap) => {
          buckets.set(
            key,
            new Map(
              snap.docs.map((leadSnap) => {
                const raw = leadSnap.data() as Partial<LeadDoc>;
                const leadId = raw.leadId ?? leadSnap.id;
                return [leadId, { ...raw, leadId } as LeadDoc];
              }),
            ),
          );
          sync();
        },
        (error) => {
          if ((error as { code?: string }).code === "permission-denied") return;
          console.error("Scoped leads listener error", error);
        },
      );

    const unsubs = chunk(subordinateIds, LISTENER_CHUNK_SIZE).flatMap((part, index) => [
      subscribe(`owner-${index}`, "ownerUid", part),
      subscribe(`assigned-${index}`, "assignedTo", part),
    ]);

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [subordinateIdKey, subordinateIds]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || subordinateIds.length === 0) {
      setScopedTasks([]);
      return;
    }

    const buckets = new Map<string, Map<string, CockpitTaskDoc>>();
    const sync = () => {
      const merged = new Map<string, CockpitTaskDoc>();
      buckets.forEach((group) => {
        group.forEach((task, taskId) => merged.set(taskId, task));
      });
      setScopedTasks(Array.from(merged.values()));
    };

    const subscribe = (key: string, field: "assignedTo" | "assigneeUid", values: string[]) =>
      onSnapshot(
        query(
          collection(firestore, "tasks"),
          where(field, "in", values),
          limit(LISTENER_LIMIT),
        ),
        (snap) => {
          buckets.set(
            key,
            new Map(
              snap.docs.map((taskSnap) => [
                taskSnap.id,
                normalizeCockpitTask(taskSnap.data() as Record<string, unknown>, taskSnap.id),
              ]),
            ),
          );
          sync();
        },
        (error) => {
          if ((error as { code?: string }).code === "permission-denied") return;
          console.error("Scoped tasks listener error", error);
        },
      );

    const unsubs = chunk(subordinateIds, LISTENER_CHUNK_SIZE).flatMap((part, index) => [
      subscribe(`assignedTo-${index}`, "assignedTo", part),
      subscribe(`assigneeUid-${index}`, "assigneeUid", part),
    ]);

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [subordinateIdKey, subordinateIds]);

  function toggleLeadSelection(leadId: string) {
    setSelectedLeadIds((current) =>
      current.includes(leadId)
        ? current.filter((value) => value !== leadId)
        : [...current, leadId],
    );
  }

  function toggleCandidateLeadSelection(leadId: string) {
    setCandidateSelectedLeadIds((current) =>
      current.includes(leadId)
        ? current.filter((value) => value !== leadId)
        : [...current, leadId],
    );
  }

  function toggleVisibleLeadSelection(leadIds: string[]) {
    const unique = Array.from(new Set(leadIds));
    setSelectedLeadIds((current) => {
      const allSelected = unique.every((leadId) => current.includes(leadId));
      if (allSelected) {
        return current.filter((leadId) => !unique.includes(leadId));
      }
      return Array.from(new Set([...current, ...unique]));
    });
  }

  function selectAllCandidateLeads() {
    setCandidateSelectedLeadIds(
      assignmentPreview.candidateLeads.map((lead) => lead.leadId),
    );
  }

  function clearCandidateLeadSelection() {
    setCandidateSelectedLeadIds([]);
  }

  async function assignLead(
    leadId: string,
    assigneeUid: string,
    lead?: LeadDoc,
    reason = "Team cockpit reassignment",
  ) {
    const firestore = db;
    if (!firestore || !uid || !actor) return;
    setReassigningLeadId(leadId);
    try {
      let currentLead = lead ?? null;
      if (!currentLead) {
        const leadSnap = await getDoc(doc(firestore, "leads", leadId));
        currentLead = leadSnap.exists()
          ? ({ ...(leadSnap.data() as LeadDoc), leadId } as LeadDoc)
          : null;
      }
      if (!currentLead) throw new Error("Lead not found.");
      const nextOwner = assignmentUsers.find((user) => user.uid === assigneeUid);

      await transferLeadCustody({
        lead: currentLead,
        actor,
        nextOwnerUid: assigneeUid,
        nextOwnerName: nextOwner ? getRepLabel(nextOwner) : assigneeUid,
        reason,
        reassignOpenTasks: true,
        workflowRemarks: reason,
      });
    } finally {
      setReassigningLeadId(null);
    }
  }

  async function createTask() {
    const firestore = db;
    if (!firestore || !uid || !newTask.assigneeUid || !newTask.title.trim()) return;
    const ref = doc(collection(firestore, "tasks"));
    await setDoc(
      ref,
      {
        id: ref.id,
        title: newTask.title.trim(),
        description: newTask.description.trim(),
        ...buildTaskWriteFields({ assigneeUid: newTask.assigneeUid, creatorUid: uid }),
        status: "pending",
        priority: newTask.priority,
        createdAt: serverTimestamp(),
        deadline: newTask.deadline ? new Date(newTask.deadline) : null,
      } satisfies Partial<TaskDoc>,
      { merge: true },
    );
    setNewTask({
      title: "",
      description: "",
      assigneeUid: "",
      priority: "medium",
      deadline: null,
    });
  }

  async function approveEnrollment(leadId: string) {
    const firestore = db;
    if (!firestore) return;
    await setDoc(
      doc(firestore, "leads", leadId),
      {
        statusDetail: {
          currentStage: "Enrollment Approved",
          isLocked: true,
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  async function applyBulkQueueAction() {
    if (!userDoc || !actor) return;
    const previewLeads = assignmentPreview.leads;
    if (previewLeads.length === 0) {
      setBulkMessage(
        bulkAction.selectionMode === "selected"
          ? "Select leads from the queues before applying the assignment desk."
          : assignmentPreview.candidateLeads.length === 0
            ? "No leads matched the candidate filters."
            : "Select the exact leads you want from the candidate list before applying.",
      );
      return;
    }
    if (
      !bulkAction.assignTo &&
      !bulkAction.status &&
      !bulkAction.followUpAt &&
      !bulkAction.source.trim() &&
      !bulkAction.campaignName.trim()
    ) {
      setBulkMessage("Choose at least one bulk action before applying it.");
      return;
    }
    if (bulkAction.assignTo && !bulkAction.transferReason.trim()) {
      setBulkMessage("Transfer reason is mandatory for assignment and pullback actions.");
      return;
    }

    setBulkSaving(true);
    setBulkMessage(null);
    try {
      let updated = 0;
      const batchIds: string[] = [];
      let writeFailureCount = 0;
      let sideEffectFailureCount = 0;
      if (bulkAction.assignTo && bulkAction.distributionMode === "team_auto_route") {
        const routingPlan = await getBulkCrmRoutingAssignments(
          bulkAction.assignTo,
          previewLeads.map((lead) => lead.leadId),
          { overrideAssigneeUid: bulkAction.routingOverrideUid || null },
        );
        const grouped = new Map<string, LeadDoc[]>();
        previewLeads.forEach((lead) => {
          const nextOwnerUid = routingPlan.get(lead.leadId) ?? bulkAction.assignTo;
          grouped.set(nextOwnerUid, [...(grouped.get(nextOwnerUid) ?? []), lead]);
        });

        for (const [assigneeUid, leads] of grouped.entries()) {
          const result = await applyBulkLeadActions({
            leads,
            actor,
            assignTo: assigneeUid,
            status: (bulkAction.status || null) as LeadStatus | null,
            followUpAt: bulkAction.followUpAt ? new Date(bulkAction.followUpAt) : null,
            source: bulkAction.source.trim() || null,
            campaignName: bulkAction.campaignName.trim() || null,
            remarks: bulkAction.remarks.trim() || null,
            transferReason: bulkAction.transferReason.trim(),
          });
          updated += result.updated;
          if (result.batchId) batchIds.push(result.batchId);
          writeFailureCount += result.writeFailures.length;
          sideEffectFailureCount += result.sideEffectFailures.length;
        }
      } else {
        const result = await applyBulkLeadActions({
          leads: previewLeads,
          actor,
          assignTo: bulkAction.assignTo || null,
          status: (bulkAction.status || null) as LeadStatus | null,
          followUpAt: bulkAction.followUpAt ? new Date(bulkAction.followUpAt) : null,
          source: bulkAction.source.trim() || null,
          campaignName: bulkAction.campaignName.trim() || null,
          remarks: bulkAction.remarks.trim() || null,
          transferReason: bulkAction.transferReason.trim() || null,
        });
        updated = result.updated;
        if (result.batchId) batchIds.push(result.batchId);
        writeFailureCount += result.writeFailures.length;
        sideEffectFailureCount += result.sideEffectFailures.length;
      }
      setBulkMessage(
        [
          `Applied the assignment desk to ${updated} lead${updated === 1 ? "" : "s"}.`,
          batchIds.length > 0 ? `Execution log batch: ${batchIds.join(", ")}` : null,
          writeFailureCount > 0
            ? `${writeFailureCount} lead write${writeFailureCount === 1 ? "" : "s"} failed validation/commit. Review execution logs before retry.`
            : null,
          sideEffectFailureCount > 0
            ? `${sideEffectFailureCount} post-write sync step${sideEffectFailureCount === 1 ? "" : "s"} failed. Check execution logs before rollback/retry.`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      setSelectedLeadIds([]);
      setCandidateSelectedLeadIds([]);
      setBulkAction({
        selectionMode: "selected",
        distributionMode: "direct",
        count: "25",
        bucket: "stale",
        filterSource: "",
        filterCampaignName: "",
        filterStatus: "",
        assignTo: "",
        status: "",
        followUpAt: "",
        source: "",
        campaignName: "",
        remarks: "",
        transferReason: "",
        routingOverrideUid: "",
      });
    } catch (error) {
      console.error("Bulk queue action failed", error);
      setBulkMessage(error instanceof Error ? error.message : "Bulk queue action failed.");
    } finally {
      setBulkSaving(false);
    }
  }

  const managerCockpit = useMemo(
    () => buildManagerCockpit({ users: subordinates, leads: scopedLeads, tasks: scopedTasks }),
    [scopedLeads, scopedTasks, subordinates],
  );
  const queueOwnerOptions = useMemo(() => {
    const labels = new Map<string, string>();
    assignmentUsers.forEach((user) => labels.set(user.uid, getRepLabel(user)));
    [managerCockpit.staleLeads, managerCockpit.overdueFollowUps, managerCockpit.closuresToday]
      .flat()
      .forEach((entry) => {
        const ownerUid = getLeadOwnerUid(entry.lead);
        if (!ownerUid || labels.has(ownerUid)) return;
        labels.set(ownerUid, entry.owner ? getRepLabel(entry.owner) : ownerUid);
      });
    return Array.from(labels.entries())
      .map(([uid, label]) => ({ uid, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [
    assignmentUsers,
    managerCockpit.closuresToday,
    managerCockpit.overdueFollowUps,
    managerCockpit.staleLeads,
  ]);
  const filteredStaleRows = useMemo(
    () =>
      filterQueueRows(managerCockpit.staleLeads, {
        searchTerm: queueSearchTerm,
        statusFilter: queueStatusFilter,
        ownerFilter: queueOwnerFilter,
      }),
    [managerCockpit.staleLeads, queueOwnerFilter, queueSearchTerm, queueStatusFilter],
  );
  const filteredOverdueRows = useMemo(
    () =>
      filterQueueRows(managerCockpit.overdueFollowUps, {
        searchTerm: queueSearchTerm,
        statusFilter: queueStatusFilter,
        ownerFilter: queueOwnerFilter,
      }),
    [managerCockpit.overdueFollowUps, queueOwnerFilter, queueSearchTerm, queueStatusFilter],
  );
  const filteredClosureRows = useMemo(
    () =>
      filterQueueRows(managerCockpit.closuresToday, {
        searchTerm: queueSearchTerm,
        statusFilter: queueStatusFilter,
        ownerFilter: queueOwnerFilter,
      }),
    [managerCockpit.closuresToday, queueOwnerFilter, queueSearchTerm, queueStatusFilter],
  );
  const queueMatchSummary = useMemo(
    () => ({
      matched:
        filteredStaleRows.length +
        filteredOverdueRows.length +
        filteredClosureRows.length,
      total:
        managerCockpit.staleLeads.length +
        managerCockpit.overdueFollowUps.length +
        managerCockpit.closuresToday.length,
    }),
    [
      filteredClosureRows.length,
      filteredOverdueRows.length,
      filteredStaleRows.length,
      managerCockpit.closuresToday.length,
      managerCockpit.overdueFollowUps.length,
      managerCockpit.staleLeads.length,
    ],
  );

  const workloadByUid = useMemo(
    () => new Map(managerCockpit.workloads.map((rep) => [rep.user.uid, rep] as const)),
    [managerCockpit.workloads],
  );

  const presenceRows = useMemo(
    () =>
      subordinates.map((user) => {
        const presence = presenceByUid[user.uid];
        const checkIn = toDate(presence?.checkedInAt);
        const activeHours =
          presence?.status === "checked_in"
            ? hoursBetween(presence?.checkedInAt, new Date())
            : hoursBetween(presence?.checkedInAt, presence?.checkedOutAt);
        return {
          uid: user.uid,
          name: getRepLabel(user),
          status: presence?.status ?? "checked_out",
          checkInAt: checkIn
            ? checkIn.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
            : "-",
          activeHours,
        };
      }),
    [presenceByUid, subordinates],
  );

  const barData = useMemo(
    () => presenceRows.map((row) => ({ name: row.name, hours: row.activeHours, goal: 8 })),
    [presenceRows],
  );

  const suggestedShift = managerCockpit.recommendedShift;

  function stageCounts(repUid: string) {
    return pipelineStats[repUid] ?? { pitch: 0, followUp: 0, enrolled: 0 };
  }

  return (
    <AuthGate allowIf={canManageTeam}>
      <div className="min-h-screen bg-white text-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <div className="text-sm font-semibold tracking-wide text-slate-500">
                Team Management
              </div>
              <Link
                href="/crm/leads?surface=workbench&import=1"
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500"
              >
                <ArrowUpTrayIcon className="h-4 w-4" />
                Import Leads in CRM
              </Link>
            </div>
            <div className="inline-flex rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-700 backdrop-blur-xl">
              {todayKey}
            </div>
          </header>

          <div className="mb-8">
            <LeadDistributorWidget />
          </div>

          <div className="mb-6 rounded-[28px] border border-slate-200 bg-slate-950 px-6 py-5 text-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Manager Cockpit</div>
                <div className="mt-1 text-sm text-slate-300">
                  Watch stale leads, missed follow-ups, rep load, and same-day closures
                  in one place.
                </div>
              </div>
              <div className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">
                {subordinatesLoading
                  ? "Loading scope..."
                  : `${managerCockpit.summary.scopedReps} reps in scope`}
              </div>
            </div>
            {suggestedShift ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100">
                Shift backlog from <span className="font-semibold">{getRepLabel(suggestedShift.from.user)}</span>{" "}
                to <span className="font-semibold">{getRepLabel(suggestedShift.to.user)}</span>.
                This is the cleanest rebalance based on stale leads, overdue
                follow-ups, and open task load.
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                No urgent load-balancing move is recommended right now.
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              {
                label: "Stale Leads",
                value: managerCockpit.summary.staleLeads,
                hint: "No activity for 24h+",
                icon: ClockIcon,
                tone: "text-amber-600 bg-amber-50",
              },
              {
                label: "Overdue Follow-ups",
                value: managerCockpit.summary.overdueFollowUps,
                hint: "Past due next steps",
                icon: ExclamationTriangleIcon,
                tone: "text-rose-600 bg-rose-50",
              },
              {
                label: "Closures Today",
                value: managerCockpit.summary.closuresToday,
                hint: "Revenue touched today",
                icon: CheckCircleIcon,
                tone: "text-emerald-600 bg-emerald-50",
              },
              {
                label: "Overloaded Reps",
                value: managerCockpit.summary.overloadedReps,
                hint: "Need intervention",
                icon: UserGroupIcon,
                tone: "text-sky-600 bg-sky-50",
              },
              {
                label: "Open Tasks",
                value: managerCockpit.summary.openTasks,
                hint: "Across your team",
                icon: InboxIcon,
                tone: "text-indigo-600 bg-indigo-50",
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-[24px] border border-slate-200 bg-white/80 p-5 shadow-sm backdrop-blur-xl"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {card.label}
                    </div>
                    <div className="mt-2 text-3xl font-semibold text-slate-900">
                      {card.value}
                    </div>
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${card.tone}`}>
                    <card.icon className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500">{card.hint}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-[24px] border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Rep Workload Heatmap</div>
                <div className="mt-1 text-xs text-slate-500">
                  Find the reps who need help now and the reps who can absorb more leads.
                </div>
              </div>
              <div className="text-xs text-slate-500">Sorted by intervention score</div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {managerCockpit.workloads.map((rep) => {
                const tone = getWorkloadTone(rep);
                const loadPercent =
                  rep.loadRatio !== null
                    ? Math.min(100, Math.round(rep.loadRatio * 100))
                    : Math.min(100, rep.activeLeads * 10);
                return (
                  <div
                    key={rep.user.uid}
                    className={`rounded-2xl border p-4 shadow-sm ${tone.card}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {getRepLabel(rep.user)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {rep.capacity
                            ? `${rep.activeLeads}/${rep.capacity} active leads`
                            : `${rep.activeLeads} active leads`}
                        </div>
                      </div>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${tone.badge}`}>
                        {tone.label}
                      </span>
                    </div>

                    <div className="mt-4 h-2 rounded-full bg-white/80">
                      <div
                        className={`h-2 rounded-full ${tone.bar}`}
                        style={{ width: `${loadPercent}%` }}
                      />
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-700">
                      <div className="rounded-xl bg-white/75 px-3 py-2">
                        <div className="text-[11px] text-slate-500">Stale</div>
                        <div className="mt-1 font-semibold">{rep.staleLeads}</div>
                      </div>
                      <div className="rounded-xl bg-white/75 px-3 py-2">
                        <div className="text-[11px] text-slate-500">Overdue</div>
                        <div className="mt-1 font-semibold">{rep.overdueFollowUps}</div>
                      </div>
                      <div className="rounded-xl bg-white/75 px-3 py-2">
                        <div className="text-[11px] text-slate-500">Due Today</div>
                        <div className="mt-1 font-semibold">{rep.dueToday}</div>
                      </div>
                      <div className="rounded-xl bg-white/75 px-3 py-2">
                        <div className="text-[11px] text-slate-500">Open Tasks</div>
                        <div className="mt-1 font-semibold">{rep.openTasks}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>Closures today: {rep.closuresToday}</span>
                      <span>Score: {Math.round(rep.score)}</span>
                    </div>
                  </div>
                );
              })}

              {managerCockpit.workloads.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-10 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">
                  No scoped reps found for this manager view.
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-slate-200 bg-white/80 p-6 shadow-sm backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Assignment Console v2</div>
                <div className="mt-1 text-xs text-slate-500">
                  Find the lead pool first, then confirm the exact leads before assigning directly or routing across a manager's team.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                  {bulkAction.selectionMode === "selected"
                    ? `${selectedLeadIds.length} checked`
                    : `${candidateSelectedLeadIds.length} picked`}
                </div>
                {bulkAction.selectionMode === "count" ? (
                  <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                    {assignmentPreview.candidateLeads.length} candidates
                  </div>
                ) : null}
                <div className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                  {assignmentPreview.leads.length} in preview
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1fr_1.05fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Selection strategy</div>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBulkMessage(null);
                      setBulkAction((current) => ({ ...current, selectionMode: "selected" }));
                    }}
                    className={`rounded-xl border px-3 py-2 text-left text-sm font-medium ${bulkAction.selectionMode === "selected" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                  >
                    Use queue selection
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkMessage(null);
                      setBulkAction((current) => ({ ...current, selectionMode: "count" }));
                    }}
                    className={`rounded-xl border px-3 py-2 text-left text-sm font-medium ${bulkAction.selectionMode === "count" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                  >
                    Find candidates by count and bucket
                  </button>
                </div>

                {bulkAction.selectionMode === "count" ? (
                  <div className="mt-4 grid gap-3">
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lead count</span>
                      <input
                        type="number"
                        min="1"
                        value={bulkAction.count}
                        onChange={(event) => setBulkAction((current) => ({ ...current, count: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                      />
                      <span className="mt-1 block text-[11px] text-slate-500">
                        This limits the candidate pool only. Nothing is selected automatically.
                      </span>
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bucket</span>
                      <select
                        value={bulkAction.bucket}
                        onChange={(event) => setBulkAction((current) => ({ ...current, bucket: event.target.value as LeadAssignmentBucket }))}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                      >
                        <option value="stale">Stale leads</option>
                        <option value="payment_follow_up">Payment follow up</option>
                        <option value="oldest">Oldest leads</option>
                        <option value="newest">Newest leads</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Filter by source</span>
                      <input
                        type="text"
                        value={bulkAction.filterSource}
                        onChange={(event) => setBulkAction((current) => ({ ...current, filterSource: event.target.value }))}
                        placeholder="Optional source filter"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Filter by campaign</span>
                      <input
                        type="text"
                        value={bulkAction.filterCampaignName}
                        onChange={(event) => setBulkAction((current) => ({ ...current, filterCampaignName: event.target.value }))}
                        placeholder="Optional campaign filter"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Filter by status</span>
                      <select
                        value={bulkAction.filterStatus}
                        onChange={(event) => setBulkAction((current) => ({ ...current, filterStatus: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                      >
                        <option value="">All statuses</option>
                        {["new", "followup", "interested", "paymentfollowup", "not_interested", "closed"].map((status) => (
                          <option key={status} value={status}>
                            {getLeadStatusLabel(status)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                      Count mode narrows the list. You still choose the exact leads from the candidate list in the preview panel.
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                    Queue checkboxes drive the preview. This is best for rescue and manual manager pullbacks.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Transfer target</div>
                <div className="mt-4 grid gap-3">
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Target mode</span>
                    <select
                      value={bulkAction.distributionMode}
                      onChange={(event) =>
                        setBulkAction((current) => ({
                          ...current,
                          distributionMode: event.target.value as "direct" | "team_auto_route",
                          routingOverrideUid: event.target.value === "team_auto_route" ? current.routingOverrideUid : "",
                        }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    >
                      <option value="direct">Direct owner transfer</option>
                      <option value="team_auto_route">Route across selected manager's team</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {bulkAction.distributionMode === "team_auto_route" ? "Manager / leader" : "Assign to"}
                    </span>
                    <select
                      value={bulkAction.assignTo}
                      onChange={(event) => setBulkAction((current) => ({ ...current, assignTo: event.target.value }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    >
                      <option value="">Select target...</option>
                      {assignmentUsers.map((user) => (
                        <option key={user.uid} value={user.uid}>
                          {getRepLabel(user)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {bulkAction.distributionMode === "team_auto_route" ? (
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Manager override (optional)</span>
                      <select
                        value={bulkAction.routingOverrideUid}
                        onChange={(event) => setBulkAction((current) => ({ ...current, routingOverrideUid: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                      >
                        <option value="">No override (fair auto-route)</option>
                        {assignmentUsers.map((user) => (
                          <option key={user.uid} value={user.uid}>
                            {getRepLabel(user)}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[11px] text-slate-500">
                        Override prefers one rep, but capacity and fairness guardrails still apply.
                      </span>
                    </label>
                  ) : null}
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Transfer reason</span>
                    <input
                      type="text"
                      value={bulkAction.transferReason}
                      onChange={(event) => setBulkAction((current) => ({ ...current, transferReason: event.target.value }))}
                      placeholder="Example: Give 50 stale leads to Manager A's team"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Optional status update</span>
                    <select
                      value={bulkAction.status}
                      onChange={(event) => setBulkAction((current) => ({ ...current, status: event.target.value }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    >
                      <option value="">Keep current status</option>
                      {["new", "followup", "interested", "paymentfollowup", "not_interested", "closed"].map((status) => (
                        <option key={status} value={status}>
                          {getLeadStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Optional follow-up date</span>
                    <input
                      type="datetime-local"
                      value={bulkAction.followUpAt}
                      onChange={(event) => setBulkAction((current) => ({ ...current, followUpAt: event.target.value }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Optional source tag</span>
                    <input
                      type="text"
                      value={bulkAction.source}
                      onChange={(event) => setBulkAction((current) => ({ ...current, source: event.target.value }))}
                      placeholder="Example: Meta Ads"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Optional campaign tag</span>
                    <input
                      type="text"
                      value={bulkAction.campaignName}
                      onChange={(event) => setBulkAction((current) => ({ ...current, campaignName: event.target.value }))}
                      placeholder="Example: June scholarship push"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Audit note</span>
                    <input
                      type="text"
                      value={bulkAction.remarks}
                      onChange={(event) => setBulkAction((current) => ({ ...current, remarks: event.target.value }))}
                      placeholder="Example: Monday recovery push"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pre-flight preview</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {assignmentPreview.leads.length} lead{assignmentPreview.leads.length === 1 ? "" : "s"} ready
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>{assignmentPreview.matchingLeads.length} matched</div>
                    <div>{assignmentPreview.skippedLocked} locked skipped</div>
                    <div>{assignmentPreview.skippedMerged} merged skipped</div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mode</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {bulkAction.selectionMode === "selected"
                        ? "Manual queue selection"
                        : `${bulkAction.count || 0} candidate leads by ${bulkAction.bucket.replace("_", " ")}`}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Destination</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {bulkAction.assignTo
                        ? getRepLabel(
                            assignmentUsers.find((user) => user.uid === bulkAction.assignTo) ?? {
                              uid: bulkAction.assignTo,
                              displayName: bulkAction.assignTo,
                              name: bulkAction.assignTo,
                              email: bulkAction.assignTo,
                            },
                          )
                        : "No owner target"}
                    </div>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Preview diff</div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                    <div className="rounded-lg bg-white px-3 py-2">Owner changes: <span className="font-semibold">{bulkPreviewDiff.ownerChanges}</span></div>
                    <div className="rounded-lg bg-white px-3 py-2">Status changes: <span className="font-semibold">{bulkPreviewDiff.statusChanges}</span></div>
                    <div className="rounded-lg bg-white px-3 py-2">Follow-up changes: <span className="font-semibold">{bulkPreviewDiff.followUpChanges}</span></div>
                    <div className="rounded-lg bg-white px-3 py-2">Source tag changes: <span className="font-semibold">{bulkPreviewDiff.sourceChanges}</span></div>
                    <div className="rounded-lg bg-white px-3 py-2 sm:col-span-2">Campaign tag changes: <span className="font-semibold">{bulkPreviewDiff.campaignChanges}</span></div>
                  </div>
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Changed lead samples
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {bulkPreviewRows.length} changed lead{bulkPreviewRows.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    {bulkPreviewRows.length === 0 ? (
                      <div className="mt-2 text-xs text-slate-500">
                        No field-level changes detected for selected leads. Applying now will still write timeline and audit records.
                      </div>
                    ) : (
                      <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                        {bulkPreviewRows.slice(0, 12).map((row) => (
                          <article key={row.leadId} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-semibold text-slate-900">
                                {row.name} | #{row.leadId.slice(-6)}
                              </div>
                              <div className="text-[11px] text-slate-500">{row.changedFields.join(", ")}</div>
                            </div>
                            <div className="mt-1 text-slate-600">
                              Owner: <span className="font-medium">{row.before.owner}</span> to <span className="font-medium">{row.after.owner}</span> | Status: <span className="font-medium">{row.before.status}</span> to <span className="font-medium">{row.after.status}</span>
                            </div>
                            <div className="mt-1 text-slate-600">
                              Follow-up: <span className="font-medium">{row.before.followUp}</span> to <span className="font-medium">{row.after.followUp}</span> | Source: <span className="font-medium">{row.before.source}</span> to <span className="font-medium">{row.after.source}</span>
                            </div>
                          </article>
                        ))}
                        {bulkPreviewRows.length > 12 ? (
                          <div className="text-[11px] text-slate-500">
                            +{bulkPreviewRows.length - 12} more changed leads in this run
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                {bulkAction.selectionMode === "count" ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Candidate list</div>
                        <div className="mt-1 text-xs text-slate-500">
                          Select the exact leads to include in the assignment.
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={selectAllCandidateLeads}
                          disabled={assignmentPreview.candidateLeads.length === 0}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Select all candidates
                        </button>
                        <button
                          type="button"
                          onClick={clearCandidateLeadSelection}
                          disabled={candidateSelectedLeadIds.length === 0}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Clear picks
                        </button>
                      </div>
                    </div>

                    {assignmentPreview.candidateLeads.length === 0 ? (
                      <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">
                        No candidate leads matched the current filters.
                      </div>
                    ) : (
                      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                        {assignmentPreview.candidateLeads.map((lead) => (
                          <label
                            key={lead.leadId}
                            className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={candidateSelectedLeadIds.includes(lead.leadId)}
                              onChange={() => toggleCandidateLeadSelection(lead.leadId)}
                              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-900">
                                {lead.name || "Unnamed lead"}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                #{lead.leadId.slice(-6)} | {getLeadStatusLabel(lead.status)}
                                {lead.source ? ` | ${lead.source}` : ""}
                                {lead.campaignName ? ` | ${lead.campaignName}` : ""}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {bulkAction.distributionMode === "team_auto_route" ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Team routing preview</div>
                    <div className="mt-3 space-y-2 text-sm text-slate-700">
                      {routePreview.loading ? (
                        <div>Loading team routing preview...</div>
                      ) : routePreview.rows.length === 0 ? (
                        <div>No team distribution preview yet.</div>
                      ) : (
                        routePreview.rows.map((row) => (
                          <div key={row.uid} className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
                            <span>{row.label}</span>
                            <span className="font-semibold">{row.count}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}

                {assignmentPreview.leads.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {assignmentPreview.leads.slice(0, 10).map((lead) => (
                      <button
                        key={lead.leadId}
                        type="button"
                        onClick={() =>
                          bulkAction.selectionMode === "selected"
                            ? toggleLeadSelection(lead.leadId)
                            : toggleCandidateLeadSelection(lead.leadId)
                        }
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {lead.name} | #{lead.leadId.slice(-6)}
                      </button>
                    ))}
                    {assignmentPreview.leads.length > 10 ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
                        +{assignmentPreview.leads.length - 10} more
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {bulkMessage ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {bulkMessage}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void applyBulkQueueAction()}
                disabled={bulkSaving || assignmentPreview.leads.length === 0}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
              >
                {bulkSaving ? "Applying..." : "Apply assignment desk"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedLeadIds([]);
                  setCandidateSelectedLeadIds([]);
                  setBulkMessage(null);
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                {bulkAction.selectionMode === "selected"
                  ? "Clear queue selection"
                  : "Clear candidate picks"}
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recent execution logs</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">Bulk run audit trail</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Every assignment desk run writes batch-level state and failure counters.
                  </div>
                </div>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
                  {bulkExecutionLogs.length} batches
                </div>
              </div>

              {bulkExecutionError ? (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {bulkExecutionError}
                </div>
              ) : null}

              {bulkExecutionLoading ? (
                <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">
                  Loading bulk execution logs...
                </div>
              ) : bulkExecutionLogs.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">
                  No bulk runs yet in this scope.
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {bulkExecutionLogs.map((log) => {
                    const startedAt = toDate(log.startedAt);
                    const completedAt = toDate(log.completedAt);
                    const isExpanded = expandedBulkBatchId === log.batchId;
                    const details = bulkExecutionDetailsByBatch[log.batchId] ?? null;
                    const hasIssues =
                      log.state === "completed_with_issues" ||
                      log.state === "failed" ||
                      log.writeFailureCount > 0 ||
                      log.sideEffectFailureCount > 0;
                    return (
                      <article key={log.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getBulkExecutionStateTone(log.state)}`}>
                                {log.state.replaceAll("_", " ")}
                              </span>
                              <span className="font-mono text-[11px] text-slate-500">{log.batchId}</span>
                            </div>
                            <div className="mt-1 text-xs text-slate-700">
                              {log.summary || "Bulk queue action"}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(log.batchId);
                            }}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            Copy batch ID
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedBulkBatchId((current) =>
                                current === log.batchId ? null : log.batchId,
                              )
                            }
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            {isExpanded ? "Hide details" : "View details"}
                          </button>
                        </div>
                        <div className="mt-2 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2 xl:grid-cols-5">
                          <div className="rounded-lg bg-slate-50 px-2 py-1.5">Updated: <span className="font-semibold text-slate-900">{log.updated}</span> / {log.requested}</div>
                          <div className="rounded-lg bg-slate-50 px-2 py-1.5">Write fails: <span className="font-semibold text-slate-900">{log.writeFailureCount}</span></div>
                          <div className="rounded-lg bg-slate-50 px-2 py-1.5">Post-write fails: <span className="font-semibold text-slate-900">{log.sideEffectFailureCount}</span></div>
                          <div className="rounded-lg bg-slate-50 px-2 py-1.5">Started: <span className="font-semibold text-slate-900">{startedAt ? startedAt.toLocaleString() : "-"}</span></div>
                          <div className="rounded-lg bg-slate-50 px-2 py-1.5">Ended: <span className="font-semibold text-slate-900">{completedAt ? completedAt.toLocaleString() : "-"}</span></div>
                        </div>
                        {hasIssues && log.failureMessage ? (
                          <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                            {log.failureMessage}
                          </div>
                        ) : null}
                        {isExpanded ? (
                          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                            {details?.loading ? (
                              <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">
                                Loading batch details...
                              </div>
                            ) : null}
                            {!details?.loading && details?.error ? (
                              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                                {details.error}
                              </div>
                            ) : null}
                            {!details?.loading && !details?.error ? (
                              <div className="grid gap-3 xl:grid-cols-2">
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lead failures</div>
                                    <div className="text-[11px] text-slate-500">{details?.failures.length ?? 0}</div>
                                  </div>
                                  {details && details.failures.length > 0 ? (
                                    <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
                                      {details.failures.map((failure) => (
                                        <article key={failure.id} className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="font-semibold">#{failure.leadId.slice(-8)} | {failure.step.replaceAll("_", " ")}</div>
                                            <Link
                                              href={`/crm/leads?surface=workbench&leadId=${encodeURIComponent(failure.leadId)}`}
                                              className="rounded-full border border-rose-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-100"
                                            >
                                              Open in CRM
                                            </Link>
                                          </div>
                                          <div className="mt-1 font-mono text-[10px] text-rose-600">{failure.leadId}</div>
                                          <div className="mt-1">{failure.error}</div>
                                          <div className="mt-1 text-[10px] text-rose-600">
                                            {toDate(failure.createdAt)?.toLocaleString() ?? "-"}
                                          </div>
                                        </article>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="mt-2 text-xs text-slate-500">No per-lead failures logged.</div>
                                  )}
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lead changes</div>
                                    <div className="text-[11px] text-slate-500">{details?.changes.length ?? 0}</div>
                                  </div>
                                  {details && details.changes.length > 0 ? (
                                    <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
                                      {details.changes.map((change) => (
                                        <article key={change.id} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700">
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="font-semibold text-slate-900">#{change.leadId.slice(-8)}</div>
                                            <Link
                                              href={`/crm/leads?surface=workbench&leadId=${encodeURIComponent(change.leadId)}`}
                                              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                                            >
                                              Open in CRM
                                            </Link>
                                          </div>
                                          <div className="mt-1 font-mono text-[10px] text-slate-500">{change.leadId}</div>
                                          <div className="mt-1">{change.summary || "Bulk queue action applied."}</div>
                                          <div className="mt-1 text-slate-600">
                                            Owner: {change.beforeOwner ?? "Pool"} to {change.afterOwner ?? "Pool"} | Status: {change.beforeStatus ?? "-"} to {change.afterStatus ?? "-"}
                                          </div>
                                          <div className="mt-1 text-[10px] text-slate-500">
                                            {toDate(change.createdAt)?.toLocaleString() ?? "-"}
                                          </div>
                                        </article>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="mt-2 text-xs text-slate-500">No lead-level change snapshot found for this batch.</div>
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Queue smart filters</div>
                <div className="mt-1 text-xs text-slate-500">
                  Apply one filter layer across stale, overdue, and closure queues.
                </div>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                {queueMatchSummary.matched} matches / {queueMatchSummary.total}
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search lead</span>
                <input
                  type="text"
                  value={queueSearchTerm}
                  onChange={(event) => setQueueSearchTerm(event.target.value)}
                  placeholder="Name, phone, lead ID, source..."
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lead status</span>
                <select
                  value={queueStatusFilter}
                  onChange={(event) => setQueueStatusFilter(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                >
                  <option value="all">All statuses</option>
                  {["new", "followup", "interested", "paymentfollowup", "not_interested", "closed"].map((status) => (
                    <option key={status} value={status}>
                      {getLeadStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Owner</span>
                <select
                  value={queueOwnerFilter}
                  onChange={(event) => setQueueOwnerFilter(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                >
                  <option value="all">All owners + pool</option>
                  <option value="pool">Pool / unassigned</option>
                  {queueOwnerOptions.map((option) => (
                    <option key={option.uid} value={option.uid}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rows per queue</span>
                <select
                  value={String(queueVisibleLimit)}
                  onChange={(event) => setQueueVisibleLimit(Number(event.target.value) || 6)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                >
                  {[6, 12, 24].map((limit) => (
                    <option key={limit} value={String(limit)}>
                      {limit} rows
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <QueuePanel
              title="No Activity 24h"
              subtitle="Stale leads that need a manager nudge or reassignment."
              rows={filteredStaleRows}
              emptyTitle="No stale leads"
              emptyMessage="The team is touching every lead within SLA."
              subordinates={assignmentUsers}
              suggestedAssigneeUid={suggestedShift?.to.user.uid ?? null}
              onAssign={(lead, assigneeUid) => assignLead(lead.leadId, assigneeUid, lead, "Recovered from no activity queue")}
              busyLeadId={reassigningLeadId}
              selectedLeadIds={new Set(selectedLeadIds)}
              onToggleLead={toggleLeadSelection}
              onToggleVisible={toggleVisibleLeadSelection}
              visibleLimit={queueVisibleLimit}
            />
            <QueuePanel
              title="Missed Follow-ups"
              subtitle="Leads where the promised next step has already slipped."
              rows={filteredOverdueRows}
              emptyTitle="No overdue follow-ups"
              emptyMessage="All follow-up commitments are still on track."
              subordinates={assignmentUsers}
              suggestedAssigneeUid={suggestedShift?.to.user.uid ?? null}
              onAssign={(lead, assigneeUid) => assignLead(lead.leadId, assigneeUid, lead, "Recovered from missed follow-up queue")}
              busyLeadId={reassigningLeadId}
              selectedLeadIds={new Set(selectedLeadIds)}
              onToggleLead={toggleLeadSelection}
              onToggleVisible={toggleVisibleLeadSelection}
              visibleLimit={queueVisibleLimit}
            />
            <QueuePanel
              title="Closures Today"
              subtitle="Same-day wins to review for QA, docs, and approvals."
              rows={filteredClosureRows}
              emptyTitle="No closures yet today"
              emptyMessage="Revenue wins will show here once the team closes them."
              subordinates={assignmentUsers}
              suggestedAssigneeUid={null}
              onAssign={(lead, assigneeUid) => assignLead(lead.leadId, assigneeUid, lead, "Closure review handoff")}
              busyLeadId={reassigningLeadId}
              selectedLeadIds={new Set(selectedLeadIds)}
              onToggleLead={toggleLeadSelection}
              onToggleVisible={toggleVisibleLeadSelection}
              visibleLimit={queueVisibleLimit}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="rounded-[24px] border border-slate-200 bg-white/70 p-6 backdrop-blur-xl lg:col-span-1">
              <div className="text-sm font-semibold">Team Presence Monitor</div>
              <div className="mt-3 space-y-2">
                {presenceRows.map((row) => (
                  <motion.button
                    key={row.uid}
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setExpandedUid((current) => (current === row.uid ? null : row.uid))}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-left text-sm"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${getPresenceTone(row.status)}`} />
                      <span className="truncate font-medium">{row.name}</span>
                    </span>
                    <span className="text-right text-xs text-slate-500">
                      In: {row.checkInAt} | {row.activeHours}h
                    </span>
                  </motion.button>
                ))}
              </div>
              <AnimatePresence initial={false}>
                {expandedUid ? (
                  <motion.div
                    key={expandedUid}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white/80"
                  >
                    <div className="space-y-2 px-3 py-3 text-xs text-slate-600">
                      <div>
                        Leads: pitch {stageCounts(expandedUid).pitch}, follow-up {stageCounts(expandedUid).followUp}, enrolled {stageCounts(expandedUid).enrolled}
                      </div>
                      <div>
                        Intervention: stale {workloadByUid.get(expandedUid)?.staleLeads ?? 0}, overdue {workloadByUid.get(expandedUid)?.overdueFollowUps ?? 0}, open tasks {workloadByUid.get(expandedUid)?.openTasks ?? 0}
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white/70 p-6 backdrop-blur-xl lg:col-span-2">
              <div className="text-sm font-semibold">Login Hours Analytics</div>
              <div className="mt-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {barData.map((bar) => (
                    <div key={bar.name} className="rounded-xl border border-slate-200 bg-white/80 p-3">
                      <div className="text-xs text-slate-500">{bar.name}</div>
                      <div className="mt-1 flex items-center justify-between">
                        <div className="text-sm font-semibold">{bar.hours}h</div>
                        <div className="text-[11px] text-slate-500">Goal 8h</div>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-indigo-600"
                          style={{ width: `${Math.min(100, Math.round((bar.hours / bar.goal) * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="rounded-[24px] border border-slate-200 bg-white/70 p-6 backdrop-blur-xl lg:col-span-2">
              <div className="text-sm font-semibold">Lead Status Pipeline (Team View)</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {subordinates.map((user) => {
                  const pipeline = stageCounts(user.uid);
                  return (
                    <div key={user.uid} className="rounded-xl border border-slate-200 bg-white/80 p-3 text-sm">
                      <div className="font-semibold">{getRepLabel(user)}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-xs text-slate-500">Pitch</div>
                        <div className="text-xs font-semibold">{pipeline.pitch}</div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-xs text-slate-500">Follow Up</div>
                        <div className="text-xs font-semibold">{pipeline.followUp}</div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-xs text-slate-500">Enrolled</div>
                        <div className="text-xs font-semibold">{pipeline.enrolled}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur-xl">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <UserGroupIcon className="h-4 w-4" />
                  </div>
                  <div className="text-sm font-semibold text-slate-900">Lead Assignment</div>
                </div>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-600/10">
                  {unassignedLeads.length} pending
                </span>
              </div>

              <div className="space-y-3">
                {paginatedUnassignedLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="group relative flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 p-3 shadow-sm transition-all hover:border-indigo-100 hover:bg-white hover:shadow-md"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-xs font-bold uppercase text-slate-600 ring-2 ring-white">
                        {(lead.name || "--").slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{lead.name}</div>
                        <div className="truncate font-mono text-[10px] text-slate-500">#{lead.id.slice(-6)}</div>
                      </div>
                    </div>

                    <div className="relative shrink-0">
                      <select
                        className="appearance-none cursor-pointer rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-9 text-xs font-medium text-slate-700 shadow-sm transition-all hover:border-indigo-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        defaultValue=""
                        onChange={(event) => {
                          const nextUid = event.target.value;
                          event.target.value = "";
                          if (!nextUid) return;
                          void assignLead(lead.id, nextUid, undefined, "Assigned from shared lead pool");
                        }}
                      >
                        <option value="">Assign to...</option>
                        {assignmentUsers.map((user) => (
                          <option key={user.uid} value={user.uid}>
                            {getRepLabel(user)}
                          </option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                        <svg className="h-3 w-3 fill-current" viewBox="0 0 20 20">
                          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd" />
                        </svg>
                      </div>
                    </div>
                  </div>
                ))}

                {unassignedLeads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-8 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                      <InboxIcon className="h-5 w-5 text-slate-400" />
                    </div>
                    <div className="mt-2 text-xs font-medium text-slate-900">All caught up</div>
                    <div className="text-[11px] text-slate-500">No unassigned leads remaining.</div>
                  </div>
                ) : (
                  <div className="border-t border-slate-100/50 pt-3">
                    <Pagination
                      currentPage={unassignedPage}
                      itemsPerPage={unassignedPerPage}
                      totalCurrentItems={paginatedUnassignedLeads.length}
                      totalItems={unassignedLeads.length}
                      hasMore={unassignedPage * unassignedPerPage < unassignedLeads.length}
                      loading={false}
                      onPrev={() => setUnassignedPage((page) => Math.max(1, page - 1))}
                      onNext={() => setUnassignedPage((page) => page + 1)}
                      label="leads"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="rounded-[24px] border border-slate-200 bg-white/70 p-6 backdrop-blur-xl">
              <div className="text-sm font-semibold">Daily Task Allotment</div>
              <div className="mt-3 space-y-2">
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Title"
                  value={newTask.title}
                  onChange={(event) => setNewTask((current) => ({ ...current, title: event.target.value }))}
                />
                <textarea
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Description"
                  value={newTask.description}
                  onChange={(event) => setNewTask((current) => ({ ...current, description: event.target.value }))}
                />
                <div className="flex gap-2">
                  <select
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={newTask.assigneeUid}
                    onChange={(event) => setNewTask((current) => ({ ...current, assigneeUid: event.target.value }))}
                  >
                    <option value="">Assign to...</option>
                    {assignmentUsers.map((user) => (
                      <option key={user.uid} value={user.uid}>
                        {getRepLabel(user)}
                      </option>
                    ))}
                  </select>
                  <select
                    className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={newTask.priority}
                    onChange={(event) =>
                      setNewTask((current) => ({
                        ...current,
                        priority: event.target.value as "high" | "medium" | "low",
                      }))
                    }
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <input
                  type="date"
                  className="w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={newTask.deadline ?? ""}
                  onChange={(event) => setNewTask((current) => ({ ...current, deadline: event.target.value || null }))}
                />
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  onClick={() => void createTask()}
                >
                  Push Task
                </motion.button>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur-xl lg:col-span-2">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-slate-900">Management Approval Queue</div>
                </div>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-600/10">
                  {approvalLeads.length} pending
                </span>
              </div>
              <div className="space-y-3">
                {paginatedApprovalLeads.map((lead) => (
                  <div key={lead.id} className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white/80 p-3 text-sm shadow-sm transition-all hover:border-indigo-100 hover:bg-white hover:shadow-md">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 text-xs font-bold uppercase text-emerald-700 ring-2 ring-white">
                        {(lead.name || "--").slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{lead.name}</div>
                        <div className="font-mono text-xs text-slate-500">Owner: {lead.ownerUid ?? "-"}</div>
                      </div>
                    </div>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.98 }}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                      onClick={() => void approveEnrollment(lead.id)}
                    >
                      Approve
                    </motion.button>
                  </div>
                ))}
                {approvalLeads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-8 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                      <InboxIcon className="h-5 w-5 text-slate-400" />
                    </div>
                    <div className="mt-2 text-xs font-medium text-slate-900">No pending approvals</div>
                    <div className="text-[11px] text-slate-500">You are all set for now.</div>
                  </div>
                ) : (
                  <div className="border-t border-slate-100/50 pt-3">
                    <Pagination
                      currentPage={approvalPage}
                      itemsPerPage={approvalPerPage}
                      totalCurrentItems={paginatedApprovalLeads.length}
                      totalItems={approvalLeads.length}
                      hasMore={approvalPage * approvalPerPage < approvalLeads.length}
                      loading={false}
                      onPrev={() => setApprovalPage((page) => Math.max(1, page - 1))}
                      onNext={() => setApprovalPage((page) => page + 1)}
                      label="approvals"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
