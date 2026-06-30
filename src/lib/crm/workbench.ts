import { getPrimaryRole } from "@/lib/access";
import {
  getLeadStatusLabel,
  isClosedLeadStatus,
  isPaymentFollowUpStatus,
  normalizeLeadStatus,
  type CanonicalLeadStatus,
} from "@/lib/leads/status";
import type { LeadDoc, LeadStructuredActivityType } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";
import { isRevenueLead } from "@/lib/utils/leadLogic";

export type CrmWorkbenchTabId =
  | "new_leads"
  | "worked_leads"
  | "due_today"
  | "no_activity_24h"
  | "payment_follow_up"
  | "callbacks"
  | "my_closures";

export type CrmWorkbenchTab = {
  id: CrmWorkbenchTabId;
  label: string;
  description: string;
  emptyTitle: string;
  emptyMessage: string;
};

export type CrmWorkbenchCounts = Record<CrmWorkbenchTabId, number>;
export type CrmWorkbenchStatusFilter = CanonicalLeadStatus | "all";
export type CrmWorkbenchOwnerFilter = string | "all";
export type CrmWorkbenchActivityStateFilter =
  | "all"
  | "stale_24h"
  | "stale_3d"
  | "touched_today"
  | "due_today"
  | "overdue_followup"
  | "upcoming_followup"
  | "no_followup"
  | "payment_stage";
export type CrmWorkbenchActivityTypeFilter =
  | LeadStructuredActivityType
  | "all"
  | "none";

export type CrmWorkbenchFilters = {
  searchTerm: string;
  status: CrmWorkbenchStatusFilter;
  ownerUid: CrmWorkbenchOwnerFilter;
  importBatchId?: string | "all";
  activityState?: CrmWorkbenchActivityStateFilter;
  activityType?: CrmWorkbenchActivityTypeFilter;
  source?: string | "all";
  campaignName?: string | "all";
  leadTag?: string | "all";
  leadLocation?: string | "all";
  preferredLanguage?: string | "all";
  createdFromDateKey?: string | null;
  createdToDateKey?: string | null;
  lastTouchFromDateKey?: string | null;
  lastTouchToDateKey?: string | null;
  followUpFromDateKey?: string | null;
  followUpToDateKey?: string | null;
};

export type CrmSmartViewVisibility = "personal" | "team_shared";

export type CrmSmartViewDoc = {
  id: string;
  name: string;
  ownerUid: string;
  ownerName?: string | null;
  baseTabId: CrmWorkbenchTabId;
  filters: CrmWorkbenchFilters;
  pinned: boolean;
  isDefault: boolean;
  visibility: CrmSmartViewVisibility;
  sharedWithUserUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
};

const DEFAULT_WORKBENCH_FILTERS: CrmWorkbenchFilters = {
  searchTerm: "",
  status: "all",
  ownerUid: "all",
  importBatchId: "all",
  activityState: "all",
  activityType: "all",
  source: "all",
  campaignName: "all",
  leadTag: "all",
  leadLocation: "all",
  preferredLanguage: "all",
  createdFromDateKey: null,
  createdToDateKey: null,
  lastTouchFromDateKey: null,
  lastTouchToDateKey: null,
  followUpFromDateKey: null,
  followUpToDateKey: null,
};

const WORKBENCH_STATUS_FILTERS: CrmWorkbenchStatusFilter[] = [
  "all",
  "new",
  "followup",
  "interested",
  "paymentfollowup",
  "closed",
];
const WORKBENCH_ACTIVITY_STATE_FILTERS: CrmWorkbenchActivityStateFilter[] = [
  "all",
  "due_today",
  "overdue_followup",
  "upcoming_followup",
  "no_followup",
  "touched_today",
  "stale_24h",
  "stale_3d",
  "payment_stage",
];
const WORKBENCH_ACTIVITY_TYPE_FILTERS: CrmWorkbenchActivityTypeFilter[] = [
  "all",
  "none",
  "call_connected",
  "call_not_connected",
  "demo_done",
  "docs_requested",
  "docs_received",
  "fee_discussed",
  "parent_call",
  "payment_reminder",
];

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    return new Date((value as { seconds: number }).seconds * 1000);
  }

  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeTextFilter(value: unknown) {
  if (typeof value !== "string") return "all" as const;
  const trimmed = value.trim();
  return trimmed || ("all" as const);
}

function parseDateKey(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function matchesDateWindow(
  date: Date | null,
  fromDateKey?: string | null,
  toDateKey?: string | null,
) {
  if (!fromDateKey && !toDateKey) return true;
  if (!date) return false;
  const fromDate = parseDateKey(fromDateKey);
  const toDate = parseDateKey(toDateKey);
  if (fromDate && date < fromDate) return false;
  if (toDate) {
    const inclusiveEnd = new Date(toDate);
    inclusiveEnd.setHours(23, 59, 59, 999);
    if (date > inclusiveEnd) return false;
  }
  return true;
}

function normalizeComparable(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function includesComparable(
  values: Array<string | null | undefined>,
  target: string,
) {
  const normalizedTarget = normalizeComparable(target);
  if (!normalizedTarget) return true;
  return values.some((value) => normalizeComparable(value) === normalizedTarget);
}

function isMergedLead(lead: Pick<LeadDoc, "mergeState"> | null | undefined) {
  return lead?.mergeState === "merged";
}

function getLastTouchDate(lead: LeadDoc) {
  const explicitActivity = parseDateValue(lead.lastActivityAt);
  if (explicitActivity) return explicitActivity;

  if (lead.lastContactDateKey) {
    const parsed = new Date(`${lead.lastContactDateKey}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return (
    parseDateValue(lead.lastActionAt) ??
    parseDateValue(lead.updatedAt) ??
    parseDateValue(lead.createdAt)
  );
}

function getFollowUpDate(lead: LeadDoc) {
  if (lead.nextFollowUp) {
    return parseDateValue(lead.nextFollowUp);
  }

  if (lead.nextFollowUpDateKey) {
    const parsed = new Date(`${lead.nextFollowUpDateKey}T09:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function getClosureDate(lead: LeadDoc) {
  return (
    parseDateValue(lead.enrollmentDetails?.closedAt) ??
    parseDateValue(lead.closedAt) ??
    parseDateValue(lead.updatedAt) ??
    parseDateValue(lead.createdAt)
  );
}

export function isLeadDueToday(lead: LeadDoc, now = new Date()) {
  return lead.nextFollowUpDateKey === toDateKey(now);
}

export function isLeadStale24h(lead: LeadDoc, now = new Date()) {
  if (isRevenueLead(lead) || isClosedLeadStatus(lead.status)) return false;

  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  if (lead.lastContactDateKey) {
    return lead.lastContactDateKey < toDateKey(cutoff);
  }

  const lastTouch = getLastTouchDate(lead);
  return lastTouch ? lastTouch < cutoff : false;
}

export function isLeadStaleForDays(lead: LeadDoc, days: number, now = new Date()) {
  if (isRevenueLead(lead) || isClosedLeadStatus(lead.status)) return false;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const lastTouch = getLastTouchDate(lead);
  return lastTouch ? lastTouch < cutoff : false;
}

export function isCallbackLead(lead: LeadDoc, now = new Date()) {
  if (isRevenueLead(lead) || isClosedLeadStatus(lead.status)) return false;
  if (isLeadDueToday(lead, now)) return false;

  const normalizedStatus = normalizeLeadStatus(lead.status);
  const currentReason = (lead.statusDetail?.currentReason ?? "").toLowerCase();
  const currentStage = (lead.statusDetail?.currentStage ?? "").toLowerCase();

  return (
    normalizedStatus === "followup" ||
    currentReason.includes("call back") ||
    currentReason.includes("callback") ||
    currentStage.includes("call back") ||
    Boolean(lead.nextFollowUpDateKey)
  );
}

export function matchesWorkbenchSearch(lead: LeadDoc, rawTerm: string) {
  const term = rawTerm.trim().toLowerCase();
  if (!term) return true;

  return [
    lead.leadId,
    lead.name,
    lead.phone,
    lead.email,
    lead.targetDegree,
    lead.targetUniversity,
    lead.leadLocation,
    lead.preferredLanguage,
    lead.source,
    lead.campaignName,
    lead.importBatchId,
    ...(lead.importTags ?? []),
    ...(lead.leadTags ?? []),
    lead.statusDetail?.currentReason,
    lead.subStatus,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(term));
}

export function getWorkbenchStatusFilterOptions() {
  return WORKBENCH_STATUS_FILTERS.map((status) => ({
    value: status,
    label: status === "all" ? "All statuses" : getLeadStatusLabel(status),
  }));
}

export function getWorkbenchActivityStateFilterOptions() {
  return WORKBENCH_ACTIVITY_STATE_FILTERS.map((state) => ({
    value: state,
    label: (() => {
      switch (state) {
        case "all":
          return "All activity states";
        case "due_today":
          return "Due today";
        case "overdue_followup":
          return "Overdue follow-up";
        case "upcoming_followup":
          return "Upcoming follow-up";
        case "no_followup":
          return "No follow-up set";
        case "touched_today":
          return "Touched today";
        case "stale_24h":
          return "No activity in 24h";
        case "stale_3d":
          return "No activity in 3 days";
        case "payment_stage":
          return "Payment stage";
        default:
          return "All activity states";
      }
    })(),
  }));
}

export function getWorkbenchActivityTypeFilterOptions() {
  return WORKBENCH_ACTIVITY_TYPE_FILTERS.map((type) => ({
    value: type,
    label: (() => {
      switch (type) {
        case "all":
          return "All activity types";
        case "none":
          return "No structured activity";
        case "call_connected":
          return "Call connected";
        case "call_not_connected":
          return "Call not connected";
        case "demo_done":
          return "Demo done";
        case "docs_requested":
          return "Docs requested";
        case "docs_received":
          return "Docs received";
        case "fee_discussed":
          return "Fee discussed";
        case "parent_call":
          return "Parent call";
        case "payment_reminder":
          return "Payment reminder";
        default:
          return "All activity types";
      }
    })(),
  }));
}

export function normalizeWorkbenchFilters(
  filters?: Partial<CrmWorkbenchFilters> | null,
): CrmWorkbenchFilters {
  const status = filters?.status ? normalizeLeadStatus(filters.status) : "all";
  const ownerUid =
    typeof filters?.ownerUid === "string" && filters.ownerUid.trim()
      ? filters.ownerUid
      : "all";
  const importBatchId =
    typeof filters?.importBatchId === "string" && filters.importBatchId.trim()
      ? filters.importBatchId
      : "all";
  const activityState: CrmWorkbenchActivityStateFilter = WORKBENCH_ACTIVITY_STATE_FILTERS.includes(
    (filters?.activityState ?? "all") as CrmWorkbenchActivityStateFilter,
  )
    ? ((filters?.activityState ?? "all") as CrmWorkbenchActivityStateFilter)
    : "all";
  const activityType: CrmWorkbenchActivityTypeFilter = WORKBENCH_ACTIVITY_TYPE_FILTERS.includes(
    (filters?.activityType ?? "all") as CrmWorkbenchActivityTypeFilter,
  )
    ? ((filters?.activityType ?? "all") as CrmWorkbenchActivityTypeFilter)
    : "all";

  return {
    searchTerm: typeof filters?.searchTerm === "string" ? filters.searchTerm : "",
    status: filters?.status === "all" ? "all" : status,
    ownerUid,
    importBatchId,
    activityState,
    activityType,
    source: normalizeTextFilter(filters?.source),
    campaignName: normalizeTextFilter(filters?.campaignName),
    leadTag: normalizeTextFilter(filters?.leadTag),
    leadLocation: normalizeTextFilter(filters?.leadLocation),
    preferredLanguage: normalizeTextFilter(filters?.preferredLanguage),
    createdFromDateKey: normalizeDateKey(filters?.createdFromDateKey),
    createdToDateKey: normalizeDateKey(filters?.createdToDateKey),
    lastTouchFromDateKey: normalizeDateKey(filters?.lastTouchFromDateKey),
    lastTouchToDateKey: normalizeDateKey(filters?.lastTouchToDateKey),
    followUpFromDateKey: normalizeDateKey(filters?.followUpFromDateKey),
    followUpToDateKey: normalizeDateKey(filters?.followUpToDateKey),
  };
}

export function normalizeSmartViewDoc(
  row: Partial<CrmSmartViewDoc> & Record<string, unknown>,
  id: string,
): CrmSmartViewDoc {
  const baseTabId = typeof row.baseTabId === "string"
    ? row.baseTabId
    : "new_leads";
  const sharedWithUserUids = Array.isArray(row.sharedWithUserUids)
    ? row.sharedWithUserUids
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
    : [];

  return {
    id,
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Saved View",
    ownerUid: typeof row.ownerUid === "string" ? row.ownerUid : "",
    ownerName: typeof row.ownerName === "string" ? row.ownerName : null,
    baseTabId: (
      [
        "new_leads",
        "worked_leads",
        "due_today",
        "no_activity_24h",
        "payment_follow_up",
        "callbacks",
        "my_closures",
      ] as CrmWorkbenchTabId[]
    ).includes(baseTabId as CrmWorkbenchTabId)
      ? (baseTabId as CrmWorkbenchTabId)
      : "new_leads",
    filters: normalizeWorkbenchFilters(row.filters as Partial<CrmWorkbenchFilters> | null),
    pinned: row.pinned === true,
    isDefault: row.isDefault === true,
    visibility: row.visibility === "team_shared" ? "team_shared" : "personal",
    sharedWithUserUids,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function sortSmartViews(views: CrmSmartViewDoc[]) {
  return [...views].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    if (left.visibility !== right.visibility) {
      return left.visibility === "team_shared" ? -1 : 1;
    }

    const leftUpdated = parseDateValue(left.updatedAt)?.getTime() ?? 0;
    const rightUpdated = parseDateValue(right.updatedAt)?.getTime() ?? 0;
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;

    return left.name.localeCompare(right.name);
  });
}

export function getCrmWorkbenchTabs(user: UserDoc): CrmWorkbenchTab[] {
  const primaryRole = getPrimaryRole(user);
  const closureLabel =
    primaryRole === "MANAGER" ||
    primaryRole === "TEAM_LEAD" ||
    primaryRole === "ADMIN" ||
    primaryRole === "SUPER_ADMIN"
      ? "Team Closures"
      : "My Closures";

  return [
    {
      id: "new_leads",
      label: "New Leads",
      description: "Fresh assignments that need the first touch.",
      emptyTitle: "No fresh leads in this queue",
      emptyMessage: "New assignments will appear here as soon as they land.",
    },
    {
      id: "worked_leads",
      label: "Worked Leads",
      description: "Previously touched leads that still need review or context.",
      emptyTitle: "No worked leads in this queue",
      emptyMessage:
        "Once a lead is touched or moved past new, it will show up here.",
    },
    {
      id: "due_today",
      label: "Due Today",
      description: "Follow-ups scheduled for today.",
      emptyTitle: "Nothing due today",
      emptyMessage:
        "Follow-up commitments scheduled for today will show up here.",
    },
    {
      id: "no_activity_24h",
      label: "No Activity 24h",
      description: "Leads that have gone stale and need attention.",
      emptyTitle: "No stale leads right now",
      emptyMessage:
        "This queue stays clear when every lead gets touched within 24 hours.",
    },
    {
      id: "payment_follow_up",
      label: "Payment Follow Up",
      description: "High-intent leads in the payment stage.",
      emptyTitle: "No payment follow-ups pending",
      emptyMessage:
        "Payment-stage leads will show here for fast chasing.",
    },
    {
      id: "callbacks",
      label: "Callbacks",
      description: "Warm leads waiting for a promised callback.",
      emptyTitle: "No callback promises pending",
      emptyMessage:
        "Callback commitments and follow-up leads will collect here.",
    },
    {
      id: "my_closures",
      label: closureLabel,
      description: "Recent revenue-generating closures in this scope.",
      emptyTitle: "No closures yet",
      emptyMessage:
        "Revenue-ready closures will show here for review and follow-through.",
    },
  ];
}

export function filterWorkbenchLeads(
  leads: LeadDoc[],
  tabId: CrmWorkbenchTabId,
  now = new Date(),
) {
  return leads.filter((lead) => {
    if (isMergedLead(lead)) return false;
    switch (tabId) {
      case "new_leads":
        return normalizeLeadStatus(lead.status) === "new";
      case "worked_leads":
        return normalizeLeadStatus(lead.status) !== "new";
      case "due_today":
        return isLeadDueToday(lead, now) && !isRevenueLead(lead);
      case "no_activity_24h":
        return isLeadStale24h(lead, now);
      case "payment_follow_up":
        return isPaymentFollowUpStatus(lead.status);
      case "callbacks":
        return isCallbackLead(lead, now);
      case "my_closures":
        return isRevenueLead(lead);
      default:
        return false;
    }
  });
}

export function applyWorkbenchFilters(
  leads: LeadDoc[],
  filters: CrmWorkbenchFilters,
  now = new Date(),
) {
  const todayKey = toDateKey(now);
  return leads.filter((lead) => {
    if (isMergedLead(lead)) return false;
    if (!matchesWorkbenchSearch(lead, filters.searchTerm)) return false;

    if (filters.status !== "all" && normalizeLeadStatus(lead.status) !== filters.status) {
      return false;
    }

    if (filters.ownerUid !== "all") {
      const ownerUid = lead.assignedTo ?? lead.ownerUid ?? null;
      if (ownerUid !== filters.ownerUid) return false;
    }

    if (filters.importBatchId && filters.importBatchId !== "all") {
      if ((lead.importBatchId ?? null) !== filters.importBatchId) return false;
    }

    if (filters.activityState && filters.activityState !== "all") {
      switch (filters.activityState) {
        case "stale_24h":
          if (!isLeadStale24h(lead, now)) return false;
          break;
        case "stale_3d":
          if (!isLeadStaleForDays(lead, 3, now)) return false;
          break;
        case "touched_today": {
          const touchedAt = getLastTouchDate(lead);
          if (!touchedAt || toDateKey(touchedAt) !== todayKey) {
            return false;
          }
          break;
        }
        case "due_today":
          if ((lead.nextFollowUpDateKey ?? null) !== todayKey) return false;
          break;
        case "overdue_followup":
          if (!lead.nextFollowUpDateKey || lead.nextFollowUpDateKey >= todayKey) return false;
          break;
        case "upcoming_followup":
          if (!lead.nextFollowUpDateKey || lead.nextFollowUpDateKey <= todayKey) return false;
          break;
        case "no_followup":
          if (lead.nextFollowUpDateKey) return false;
          break;
        case "payment_stage":
          if (!isPaymentFollowUpStatus(lead.status)) return false;
          break;
      }
    }

    if (filters.activityType && filters.activityType !== "all") {
      if (filters.activityType === "none") {
        if (lead.lastActivityType) return false;
      } else if (lead.lastActivityType !== filters.activityType) {
        return false;
      }
    }

    if (filters.source && filters.source !== "all") {
      if (normalizeComparable(lead.source) !== normalizeComparable(filters.source)) return false;
    }

    if (filters.campaignName && filters.campaignName !== "all") {
      if (normalizeComparable(lead.campaignName) !== normalizeComparable(filters.campaignName)) return false;
    }

    if (filters.leadTag && filters.leadTag !== "all") {
      if (
        !includesComparable(
          [...(lead.leadTags ?? []), ...(lead.importTags ?? [])],
          filters.leadTag,
        )
      ) {
        return false;
      }
    }

    if (filters.leadLocation && filters.leadLocation !== "all") {
      if (normalizeComparable(lead.leadLocation) !== normalizeComparable(filters.leadLocation)) return false;
    }

    if (filters.preferredLanguage && filters.preferredLanguage !== "all") {
      if (
        normalizeComparable(lead.preferredLanguage) !==
        normalizeComparable(filters.preferredLanguage)
      ) {
        return false;
      }
    }

    const createdDate = parseDateValue(lead.createdAt);
    if (
      !matchesDateWindow(
        createdDate,
        filters.createdFromDateKey,
        filters.createdToDateKey,
      )
    ) {
      return false;
    }

    const lastTouchDate = getLastTouchDate(lead);
    if (
      !matchesDateWindow(
        lastTouchDate,
        filters.lastTouchFromDateKey,
        filters.lastTouchToDateKey,
      )
    ) {
      return false;
    }

    const followUpDate = getFollowUpDate(lead);
    if (
      !matchesDateWindow(
        followUpDate,
        filters.followUpFromDateKey,
        filters.followUpToDateKey,
      )
    ) {
      return false;
    }

    return true;
  });
}

function toSortableNumber(date: Date | null) {
  return date ? date.getTime() : 0;
}

export function sortWorkbenchLeads(
  leads: LeadDoc[],
  tabId: CrmWorkbenchTabId,
) {
  return [...leads].sort((left, right) => {
    switch (tabId) {
      case "new_leads":
        return (
          toSortableNumber(
            parseDateValue(right.assignedAt) ?? parseDateValue(right.createdAt),
          ) -
          toSortableNumber(
            parseDateValue(left.assignedAt) ?? parseDateValue(left.createdAt),
          )
        );
      case "worked_leads":
        return (
          toSortableNumber(parseDateValue(right.updatedAt) ?? parseDateValue(right.createdAt)) -
            toSortableNumber(parseDateValue(left.updatedAt) ?? parseDateValue(left.createdAt)) ||
          toSortableNumber(getLastTouchDate(right)) -
            toSortableNumber(getLastTouchDate(left))
        );
      case "due_today":
        return (
          toSortableNumber(getFollowUpDate(left)) -
            toSortableNumber(getFollowUpDate(right)) ||
          toSortableNumber(parseDateValue(right.updatedAt)) -
            toSortableNumber(parseDateValue(left.updatedAt))
        );
      case "no_activity_24h":
        return toSortableNumber(getLastTouchDate(left)) -
          toSortableNumber(getLastTouchDate(right));
      case "payment_follow_up":
        return (
          toSortableNumber(getFollowUpDate(left)) -
            toSortableNumber(getFollowUpDate(right)) ||
          toSortableNumber(parseDateValue(right.updatedAt)) -
            toSortableNumber(parseDateValue(left.updatedAt))
        );
      case "callbacks":
        return (
          toSortableNumber(getFollowUpDate(left)) -
            toSortableNumber(getFollowUpDate(right)) ||
          toSortableNumber(parseDateValue(left.updatedAt)) -
            toSortableNumber(parseDateValue(right.updatedAt))
        );
      case "my_closures":
        return toSortableNumber(getClosureDate(right)) -
          toSortableNumber(getClosureDate(left));
      default:
        return 0;
    }
  });
}

export function buildWorkbenchCounts(
  leads: LeadDoc[],
  now = new Date(),
): CrmWorkbenchCounts {
  return {
    new_leads: filterWorkbenchLeads(leads, "new_leads", now).length,
    worked_leads: filterWorkbenchLeads(leads, "worked_leads", now).length,
    due_today: filterWorkbenchLeads(leads, "due_today", now).length,
    no_activity_24h: filterWorkbenchLeads(leads, "no_activity_24h", now)
      .length,
    payment_follow_up: filterWorkbenchLeads(
      leads,
      "payment_follow_up",
      now,
    ).length,
    callbacks: filterWorkbenchLeads(leads, "callbacks", now).length,
    my_closures: filterWorkbenchLeads(leads, "my_closures", now).length,
  };
}

export function buildWorkbenchCountsForFilters(
  leads: LeadDoc[],
  filters: CrmWorkbenchFilters,
  now = new Date(),
) {
  return buildWorkbenchCounts(applyWorkbenchFilters(leads, filters, now), now);
}

export function getDefaultWorkbenchTab(
  user: UserDoc,
  counts: CrmWorkbenchCounts,
): CrmWorkbenchTabId {
  const primaryRole = getPrimaryRole(user);

  if (
    primaryRole === "MANAGER" ||
    primaryRole === "TEAM_LEAD" ||
    primaryRole === "ADMIN" ||
    primaryRole === "SUPER_ADMIN"
  ) {
    if (counts.no_activity_24h > 0) return "no_activity_24h";
    if (counts.due_today > 0) return "due_today";
    if (counts.new_leads > 0) return "new_leads";
    if (counts.worked_leads > 0) return "worked_leads";
    if (counts.payment_follow_up > 0) return "payment_follow_up";
    if (counts.callbacks > 0) return "callbacks";
    return "my_closures";
  }

  if (counts.due_today > 0) return "due_today";
  if (counts.new_leads > 0) return "new_leads";
  if (counts.worked_leads > 0) return "worked_leads";
  if (counts.callbacks > 0) return "callbacks";
  if (counts.payment_follow_up > 0) return "payment_follow_up";
  if (counts.no_activity_24h > 0) return "no_activity_24h";
  return "my_closures";
}

export function getDefaultWorkbenchFilters() {
  return { ...DEFAULT_WORKBENCH_FILTERS };
}

export function getSmartViewBadge(view: CrmSmartViewDoc, currentUserUid: string) {
  if (view.ownerUid === currentUserUid && view.visibility === "team_shared") {
    return "Pushed to team";
  }
  if (view.visibility === "team_shared") {
    return "Team view";
  }
  if (view.isDefault) {
    return "Default";
  }
  if (view.pinned) {
    return "Pinned";
  }
  return "Personal";
}

export function getWorkbenchScopeLabel(
  user: UserDoc,
  scopeUids: string[] | null,
) {
  const primaryRole = getPrimaryRole(user);

  if (scopeUids === null) return "Global CRM scope";
  if (scopeUids.length <= 1) return "My queue";
  if (primaryRole === "MANAGER") {
    return `Manager scope | ${scopeUids.length} reps`;
  }
  if (primaryRole === "TEAM_LEAD") {
    return `Team scope | ${scopeUids.length} reps`;
  }
  return `Scoped CRM | ${scopeUids.length} reps`;
}

export function getLeadActionHint(lead: LeadDoc, tabId: CrmWorkbenchTabId) {
  const reason = lead.statusDetail?.currentReason ?? lead.subStatus ?? null;

  switch (tabId) {
    case "new_leads":
      return "First touch pending";
    case "worked_leads":
      return reason ? `Worked lead | ${reason}` : "Reopen context and decide the next move";
    case "due_today":
      return reason ? `Due today | ${reason}` : "Follow-up commitment due today";
    case "no_activity_24h":
      return "Re-engage this stale lead";
    case "payment_follow_up":
      return reason
        ? `Payment stage | ${reason}`
        : "Payment discussion in progress";
    case "callbacks":
      return reason ? `Callback promised | ${reason}` : "Call back and confirm next step";
    case "my_closures":
      return reason ? `Closure note | ${reason}` : "Review closed lead context";
    default:
      return "";
  }
}

export function getLeadPrimaryContext(lead: LeadDoc) {
  const university = lead.enrollmentDetails?.university ?? lead.targetUniversity;
  const course = lead.enrollmentDetails?.course ?? lead.targetDegree;
  return [course, university].filter(Boolean).join(" | ") || "Program details pending";
}

export function getLeadTimeMeta(
  lead: LeadDoc,
  tabId: CrmWorkbenchTabId,
): {
  label: string;
  date: Date | null;
} {
  switch (tabId) {
    case "worked_leads":
      return {
        label: "Updated",
        date: parseDateValue(lead.updatedAt) ?? getLastTouchDate(lead),
      };
    case "due_today":
    case "callbacks":
      return { label: "Follow-up", date: getFollowUpDate(lead) };
    case "no_activity_24h":
      return { label: "Last touch", date: getLastTouchDate(lead) };
    case "payment_follow_up":
      return {
        label: "Updated",
        date: parseDateValue(lead.updatedAt) ?? parseDateValue(lead.createdAt),
      };
    case "my_closures":
      return { label: "Closed", date: getClosureDate(lead) };
    case "new_leads":
    default:
      return {
        label: "Assigned",
        date: parseDateValue(lead.assignedAt) ?? parseDateValue(lead.createdAt),
      };
  }
}
