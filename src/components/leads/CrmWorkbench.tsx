"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  where,
  type DocumentData,
  type Query,
} from "firebase/firestore";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowPathIcon,
  BanknotesIcon,
  BookmarkIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PhoneIcon,
  TrashIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { canBulkImportLeads, canManageTeam } from "@/lib/access";
import { getLeadOverdueDays, getLeadSlaBucket } from "@/lib/crm/automation";
import { db } from "@/lib/firebase/client";
import {
  applyWorkbenchFilters,
  buildWorkbenchCountsForFilters,
  filterWorkbenchLeads,
  getCrmWorkbenchTabs,
  getDefaultWorkbenchFilters,
  getDefaultWorkbenchTab,
  getLeadActionHint,
  getLeadPrimaryContext,
  getLeadTimeMeta,
  getSmartViewBadge,
  getWorkbenchActivityStateFilterOptions,
  getWorkbenchActivityTypeFilterOptions,
  getWorkbenchScopeLabel,
  getWorkbenchStatusFilterOptions,
  normalizeSmartViewDoc,
  normalizeWorkbenchFilters,
  sortSmartViews,
  sortWorkbenchLeads,
  type CrmSmartViewDoc,
  type CrmWorkbenchFilters,
  type CrmWorkbenchTabId,
} from "@/lib/crm/workbench";
import {
  buildDuplicateLeadGroups,
  buildLeadMergePreview,
  mergeLeadIntoPrimary,
  type LeadMergeStrategy,
} from "@/lib/crm/merge";
import {
  DEFAULT_PULLBACK_REASON_TEMPLATE_ID,
  DEFAULT_REASSIGN_REASON_TEMPLATE_ID,
  getAssignmentReasonTemplate,
  getDefaultSopOutcomeForWorkbenchTab,
  type LeadSopOutcomeId,
} from "@/lib/crm/sop";
import { buildLeadActor } from "@/lib/crm/timeline";
import { applyBulkLeadActions } from "@/lib/crm/bulk-actions";
import { getLeadStatusLabel, normalizeLeadStatus } from "@/lib/leads/status";
import { getRoleLayoutProfile, type CrmCommandSection } from "@/lib/layouts/role-layout";
import type { LeadDoc } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";
import { toTitleCase } from "@/lib/utils/stringUtils";
import LeadDetailPanel from "@/components/leads/LeadDetailPanel";
import { LeadImportModal } from "@/components/leads/LeadImportModal";
import { LeadCreateModal } from "@/components/leads/LeadCreateModal";
import { updateLeadStatusInDb } from "@/lib/firebase/leads";

type Props = {
  currentUser: UserDoc;
  scopeUids: string[] | null;
  memberLookup?: Record<string, string>;
  heading: string;
  description: string;
  initialTab?: CrmWorkbenchTabId | null;
  selectionToken?: string | null;
  initialLayout?: CrmWorkbenchLayoutMode;
  allowImport?: boolean;
  allowCreateLead?: boolean;
  initialImportOpen?: boolean;
  focusLeadId?: string | null;
};

export type CrmWorkbenchLayoutMode = "cards" | "compact";

type LeadState = {
  leads: LeadDoc[];
  loading: boolean;
  error: Error | null;
  lastSyncedAt: Date | null;
};

type SmartViewState = {
  views: CrmSmartViewDoc[];
  loading: boolean;
  error: Error | null;
};

type SmartViewDraft = {
  name: string;
  pinned: boolean;
  isDefault: boolean;
  shareWithTeam: boolean;
};

type LeadSlaMeta = {
  bucket: "due_today" | "overdue";
  label: string;
  badgeClassName: string;
};

const GLOBAL_LIMIT = 1200;
const SCOPED_QUERY_LIMIT = 250;

function chunk<T>(values: T[], size = 10) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function toLeadDoc(snapshot: { id: string; data: () => DocumentData }) {
  return { ...(snapshot.data() as LeadDoc), leadId: snapshot.id } as LeadDoc;
}

function buildLeadQueries(scopeUids: string[] | null): Array<{ key: string; query: Query }> {
  if (!db) return [];
  const firestore = db;
  if (scopeUids === null) {
    return [
      {
        key: "global",
        query: query(collection(firestore, "leads"), orderBy("updatedAt", "desc"), limit(GLOBAL_LIMIT)),
      },
    ];
  }

  const unique = Array.from(new Set(scopeUids.filter(Boolean)));
  if (unique.length === 0) return [];

  return chunk(unique).flatMap((part, index) => [
    {
      key: `assigned-${index}`,
      query: query(
        collection(firestore, "leads"),
        where("assignedTo", "in", part),
        orderBy("updatedAt", "desc"),
        limit(SCOPED_QUERY_LIMIT),
      ),
    },
    {
      key: `owner-${index}`,
      query: query(
        collection(firestore, "leads"),
        where("ownerUid", "in", part),
        orderBy("updatedAt", "desc"),
        limit(SCOPED_QUERY_LIMIT),
      ),
    },
    {
      key: `closed-${index}`,
      query: query(
        collection(firestore, "leads"),
        where("closedBy.uid", "in", part),
        orderBy("updatedAt", "desc"),
        limit(SCOPED_QUERY_LIMIT),
      ),
    },
  ]);
}

function useScopedWorkbenchLeads(scopeUids: string[] | null, scopeKey: string): LeadState {
  const [state, setState] = useState<LeadState>({
    leads: [],
    loading: true,
    error: null,
    lastSyncedAt: null,
  });

  useEffect(() => {
    if (!db) {
      setState({
        leads: [],
        loading: false,
        error: new Error("Firebase is not configured"),
        lastSyncedAt: null,
      });
      return;
    }

    const queries = buildLeadQueries(scopeUids);
    if (queries.length === 0) {
      setState({ leads: [], loading: false, error: null, lastSyncedAt: new Date() });
      return;
    }

    const buckets = new Map<string, LeadDoc[]>();
    const sync = () => {
      const merged = new Map<string, LeadDoc>();
      buckets.forEach((rows) => rows.forEach((lead) => merged.set(lead.leadId, lead)));
      setState({
        leads: Array.from(merged.values()),
        loading: false,
        error: null,
        lastSyncedAt: new Date(),
      });
    };

    setState((current) => ({ ...current, loading: true, error: null }));
    const unsubscribers = queries.map(({ key, query: leadQuery }) =>
      onSnapshot(
        leadQuery,
        (snapshot) => {
          buckets.set(key, snapshot.docs.map(toLeadDoc));
          sync();
        },
        (error) => {
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error : new Error("Unable to load CRM workbench"),
          }));
        },
      ),
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [scopeKey, scopeUids]);

  return state;
}

function useCrmSmartViews(currentUserUid: string): SmartViewState {
  const [state, setState] = useState<SmartViewState>({ views: [], loading: true, error: null });

  useEffect(() => {
    if (!db) {
      setState({ views: [], loading: false, error: new Error("Firebase is not configured") });
      return;
    }
    const firestore = db;

    const buckets = new Map<string, CrmSmartViewDoc[]>();
    const sync = () => {
      const merged = new Map<string, CrmSmartViewDoc>();
      buckets.forEach((rows) => rows.forEach((view) => merged.set(view.id, view)));
      setState({ views: sortSmartViews(Array.from(merged.values())), loading: false, error: null });
    };

    const ownerQuery = query(collection(firestore, "crm_smart_views"), where("ownerUid", "==", currentUserUid), limit(40));
    const sharedQuery = query(collection(firestore, "crm_smart_views"), where("sharedWithUserUids", "array-contains", currentUserUid), limit(40));

    const unsubscribers = [
      onSnapshot(ownerQuery, (snapshot) => {
        buckets.set("owner", snapshot.docs.map((row) => normalizeSmartViewDoc(row.data(), row.id)));
        sync();
      }, (error) => setState({ views: [], loading: false, error: error instanceof Error ? error : new Error("Unable to load Smart Views") })),
      onSnapshot(sharedQuery, (snapshot) => {
        buckets.set("shared", snapshot.docs.map((row) => normalizeSmartViewDoc(row.data(), row.id)));
        sync();
      }, (error) => setState({ views: [], loading: false, error: error instanceof Error ? error : new Error("Unable to load Smart Views") })),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [currentUserUid]);

  return state;
}

function getTabIcon(tabId: CrmWorkbenchTabId) {
  switch (tabId) {
    case "new_leads":
      return CheckCircleIcon;
    case "worked_leads":
      return EyeIcon;
    case "due_today":
      return CalendarDaysIcon;
    case "no_activity_24h":
      return ClockIcon;
    case "payment_follow_up":
      return BanknotesIcon;
    case "callbacks":
      return PhoneIcon;
    case "my_closures":
      return CheckCircleIcon;
  }
}

function getMemberLabel(uid: string | null | undefined, lookup: Record<string, string>) {
  if (!uid) return "Unassigned";
  return lookup[uid] ?? uid;
}

type SmartFilterOption = {
  value: string;
  label: string;
  count?: number;
};

function buildTextFilterOptions(
  leads: LeadDoc[],
  getValue: (lead: LeadDoc) => string | null | undefined,
  max = 25,
): SmartFilterOption[] {
  const byValue = new Map<
    string,
    { value: string; count: number; updatedAtMs: number }
  >();
  leads.forEach((lead) => {
    const rawValue = getValue(lead);
    if (!rawValue) return;
    const value = rawValue.trim();
    if (!value) return;
    const key = value.toLowerCase();
    const existing = byValue.get(key) ?? {
      value,
      count: 0,
      updatedAtMs: 0,
    };
    const updatedAtMs =
      coerceDateValue(lead.updatedAt)?.getTime() ??
      coerceDateValue(lead.createdAt)?.getTime() ??
      0;
    byValue.set(key, {
      value: existing.value,
      count: existing.count + 1,
      updatedAtMs: Math.max(existing.updatedAtMs, updatedAtMs),
    });
  });

  return Array.from(byValue.entries())
    .sort((left, right) => {
      if (right[1].count !== left[1].count) {
        return right[1].count - left[1].count;
      }
      if (right[1].updatedAtMs !== left[1].updatedAtMs) {
        return right[1].updatedAtMs - left[1].updatedAtMs;
      }
      return left[1].value.localeCompare(right[1].value);
    })
    .slice(0, max)
    .map(([, meta]) => ({
      value: meta.value,
      label: meta.value,
      count: meta.count,
    }));
}

function ensureCurrentOption(
  options: SmartFilterOption[],
  currentValue?: string | null,
) {
  const value = currentValue?.trim();
  if (!value || value === "all") return options;
  if (options.some((option) => option.value === value)) return options;
  return [{ value, label: `${value} (saved)` }, ...options];
}

function buildSelectionKey(activeSmartViewId: string | null, activeTab: CrmWorkbenchTabId) {
  return activeSmartViewId ? `smart:${activeSmartViewId}` : `tab:${activeTab}`;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateWindow(from?: string | null, to?: string | null) {
  if (from && to) return `${from} to ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return "Any date";
}

function coerceDateValue(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getLeadSlaMeta(lead: LeadDoc, now: Date): LeadSlaMeta | null {
  const todayKey = toDateKey(now);
  const bucket = getLeadSlaBucket(lead, todayKey);
  if (bucket === "overdue") {
    const overdueDays = Math.max(1, getLeadOverdueDays(lead, todayKey));
    return {
      bucket: "overdue",
      label: overdueDays === 1 ? "SLA overdue by 1 day" : `SLA overdue by ${overdueDays} days`,
      badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
    };
  }
  if (bucket === "due_today") {
    return {
      bucket: "due_today",
      label: "SLA due today",
      badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
    };
  }
  return null;
}

const LEAD_FOCUS_TAB_PRIORITY: CrmWorkbenchTabId[] = [
  "due_today",
  "no_activity_24h",
  "payment_follow_up",
  "callbacks",
  "worked_leads",
  "my_closures",
  "new_leads",
];

function inferFocusTabForLead(lead: LeadDoc, now: Date): CrmWorkbenchTabId {
  for (const tabId of LEAD_FOCUS_TAB_PRIORITY) {
    if (filterWorkbenchLeads([lead], tabId, now).length > 0) {
      return tabId;
    }
  }
  return "new_leads";
}

export function CrmWorkbench({
  currentUser,
  scopeUids,
  memberLookup = {},
  heading,
  description,
  initialTab = null,
  selectionToken = null,
  initialLayout = "compact",
  allowImport = false,
  allowCreateLead = true,
  initialImportOpen = false,
  focusLeadId = null,
}: Props) {
  const scopeKey = useMemo(() => (scopeUids === null ? "global" : [...scopeUids].sort().join("|")), [scopeUids]);
  const { leads, loading, error, lastSyncedAt } = useScopedWorkbenchLeads(scopeUids, scopeKey);
  const { views: smartViews, loading: smartViewsLoading, error: smartViewsError } = useCrmSmartViews(currentUser.uid);
  const crmLayout = useMemo(() => getRoleLayoutProfile(currentUser).crm, [currentUser]);
  const tabs = useMemo(() => getCrmWorkbenchTabs(currentUser), [currentUser]);
  const statusOptions = useMemo(() => getWorkbenchStatusFilterOptions(), []);
  const activityStateOptions = useMemo(() => getWorkbenchActivityStateFilterOptions(), []);
  const activityTypeOptions = useMemo(() => getWorkbenchActivityTypeFilterOptions(), []);
  const canUseBulkAssign = canManageTeam(currentUser);
  const canPushTeamViews = canManageTeam(currentUser) && scopeUids !== null && scopeUids.length > 1;

  const [activeTab, setActiveTab] = useState<CrmWorkbenchTabId>("new_leads");
  const [activeSmartViewId, setActiveSmartViewId] = useState<string | null>(null);
  const [didInitSelection, setDidInitSelection] = useState(false);
  const [filters, setFilters] = useState<CrmWorkbenchFilters>(() => getDefaultWorkbenchFilters());
  const [layoutMode, setLayoutMode] = useState<CrmWorkbenchLayoutMode>(initialLayout);
  const [clock, setClock] = useState(() => new Date());
  const [detailLead, setDetailLead] = useState<LeadDoc | null>(null);
  const [detailSection, setDetailSection] = useState<CrmCommandSection>(crmLayout.defaultSection);
  const [detailPrefillOutcomeId, setDetailPrefillOutcomeId] = useState<LeadSopOutcomeId | null>(null);
  const [detailPrefillAssignmentReason, setDetailPrefillAssignmentReason] = useState<string | null>(null);
  const [detailPrefillAssigneeUid, setDetailPrefillAssigneeUid] = useState<string | null>(null);
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [draft, setDraft] = useState<SmartViewDraft>({ name: "", pinned: true, isDefault: false, shareWithTeam: false });
  const [viewError, setViewError] = useState<string | null>(null);
  const [savingView, setSavingView] = useState(false);
  const [activeDuplicateGroupId, setActiveDuplicateGroupId] = useState<string | null>(null);
  const [mergePrimaryLeadId, setMergePrimaryLeadId] = useState("");
  const [mergeDuplicateLeadId, setMergeDuplicateLeadId] = useState("");
  const [mergeStrategy, setMergeStrategy] = useState<LeadMergeStrategy>("recent_non_empty");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergingDuplicate, setMergingDuplicate] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState<boolean>(allowImport && initialImportOpen);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [batchFilterOpen, setBatchFilterOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [smartViewsOpen, setSmartViewsOpen] = useState(false);
  const [quickActionSavingLeadId, setQuickActionSavingLeadId] = useState<string | null>(null);
  const [quickActionMessage, setQuickActionMessage] = useState<string | null>(null);
  const [queuePageSize, setQueuePageSize] = useState(25);
  const [queuePage, setQueuePage] = useState(1);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [bulkSelectCount, setBulkSelectCount] = useState("25");
  const [bulkAssignTargetUid, setBulkAssignTargetUid] = useState("");
  const [bulkAssignReason, setBulkAssignReason] = useState("");
  const [bulkAssignSaving, setBulkAssignSaving] = useState(false);
  const [bulkAssignMessage, setBulkAssignMessage] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const lastFocusedLeadIdRef = useRef<string | null>(null);
  const appliedSelectionTokenRef = useRef<string | null>(null);

  const activeSmartView = useMemo(() => smartViews.find((view) => view.id === activeSmartViewId) ?? null, [activeSmartViewId, smartViews]);
  const ownedActiveSmartView = activeSmartView?.ownerUid === currentUser.uid ? activeSmartView : null;

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setDetailSection((current) => (crmLayout.visibleSections.includes(current) ? current : crmLayout.defaultSection));
  }, [crmLayout]);

  useEffect(() => {
    if (didInitSelection) return;
    if (selectionToken) {
      if (!initialTab && (loading || smartViewsLoading)) return;
      const resetTab =
        initialTab && tabs.some((tab) => tab.id === initialTab)
          ? initialTab
          : getDefaultWorkbenchTab(
              currentUser,
            buildWorkbenchCountsForFilters(leads, getDefaultWorkbenchFilters(), clock),
          );
      setActiveSmartViewId(null);
      setFilters(getDefaultWorkbenchFilters());
      setActiveTab(resetTab);
      setLayoutMode(initialLayout);
      setDidInitSelection(true);
      return;
    }

    if (loading || smartViewsLoading) return;

    const saved = window.localStorage.getItem(`crm-workbench:${currentUser.uid}:selection`);
    if (saved?.startsWith("smart:")) {
      const savedView = smartViews.find((view) => view.id === saved.slice(6));
      if (savedView) {
        setActiveSmartViewId(savedView.id);
        setActiveTab(savedView.baseTabId);
        setFilters(normalizeWorkbenchFilters(savedView.filters));
        const savedLayout = window.localStorage.getItem(`crm-workbench:${currentUser.uid}:layout`);
        if (savedLayout === "compact" || savedLayout === "cards") setLayoutMode(savedLayout);
        setDidInitSelection(true);
        return;
      }
    }

    if (saved?.startsWith("tab:")) {
      const savedTab = saved.slice(4) as CrmWorkbenchTabId;
      if (tabs.some((tab) => tab.id === savedTab)) setActiveTab(savedTab);
      const savedLayout = window.localStorage.getItem(`crm-workbench:${currentUser.uid}:layout`);
      if (savedLayout === "compact" || savedLayout === "cards") setLayoutMode(savedLayout);
      setDidInitSelection(true);
      return;
    }

    const defaultSmartView = smartViews.find((view) => view.ownerUid === currentUser.uid && view.isDefault) ?? null;
    if (defaultSmartView) {
      setActiveSmartViewId(defaultSmartView.id);
      setActiveTab(defaultSmartView.baseTabId);
      setFilters(normalizeWorkbenchFilters(defaultSmartView.filters));
    } else {
      setActiveTab(getDefaultWorkbenchTab(currentUser, buildWorkbenchCountsForFilters(leads, filters, clock)));
    }

    const savedLayout = window.localStorage.getItem(`crm-workbench:${currentUser.uid}:layout`);
    if (savedLayout === "compact" || savedLayout === "cards") {
      setLayoutMode(savedLayout);
    } else {
      setLayoutMode(initialLayout);
    }

    setDidInitSelection(true);
  }, [clock, currentUser, didInitSelection, filters, initialLayout, initialTab, leads, loading, selectionToken, smartViews, smartViewsLoading, tabs]);

  useEffect(() => {
    if (!selectionToken) {
      appliedSelectionTokenRef.current = null;
      return;
    }
    if (appliedSelectionTokenRef.current === selectionToken) return;
    if (!initialTab && loading) return;
    const resetTab =
      initialTab && tabs.some((tab) => tab.id === initialTab)
        ? initialTab
        : getDefaultWorkbenchTab(
            currentUser,
            buildWorkbenchCountsForFilters(leads, getDefaultWorkbenchFilters(), clock),
          );
    setActiveSmartViewId(null);
    setFilters(getDefaultWorkbenchFilters());
    setActiveTab(resetTab);
    setLayoutMode(initialLayout);
    appliedSelectionTokenRef.current = selectionToken;
  }, [clock, currentUser, initialLayout, initialTab, leads, loading, selectionToken, tabs]);

  useEffect(() => {
    if (!didInitSelection) return;
    window.localStorage.setItem(`crm-workbench:${currentUser.uid}:selection`, buildSelectionKey(activeSmartViewId, activeTab));
  }, [activeSmartViewId, activeTab, currentUser.uid, didInitSelection]);

  useEffect(() => {
    if (!didInitSelection) return;
    window.localStorage.setItem(`crm-workbench:${currentUser.uid}:layout`, layoutMode);
  }, [currentUser.uid, didInitSelection, layoutMode]);

  useEffect(() => {
    if (!isStudioOpen) return;
    setDraft({
      name: ownedActiveSmartView?.name ?? "",
      pinned: ownedActiveSmartView?.pinned ?? true,
      isDefault: ownedActiveSmartView?.isDefault ?? false,
      shareWithTeam: ownedActiveSmartView?.visibility === "team_shared",
    });
    setViewError(null);
  }, [isStudioOpen, ownedActiveSmartView]);

  useEffect(() => {
    if (!allowImport || !initialImportOpen) return;
    setIsImportOpen(true);
  }, [allowImport, initialImportOpen, selectionToken]);

  useEffect(() => {
    if (!focusLeadId) {
      lastFocusedLeadIdRef.current = null;
      return;
    }
    const normalizedLeadId = focusLeadId.trim();
    if (!normalizedLeadId) return;
    if (lastFocusedLeadIdRef.current === normalizedLeadId) return;

    const targetLead = leads.find((lead) => lead.leadId === normalizedLeadId);
    if (!targetLead) return;

    lastFocusedLeadIdRef.current = normalizedLeadId;
    setActiveSmartViewId(null);
    setFilters(getDefaultWorkbenchFilters());
    setActiveTab(inferFocusTabForLead(targetLead, clock));
    setDetailLead(targetLead);
    setDetailSection(crmLayout.defaultSection);
    setDetailPrefillOutcomeId(null);
    setDetailPrefillAssignmentReason(null);
    setDetailPrefillAssigneeUid(null);
  }, [clock, crmLayout.defaultSection, focusLeadId, leads]);

  const filteredScopeLeads = useMemo(
    () => applyWorkbenchFilters(leads, filters, clock),
    [clock, filters, leads],
  );
  const counts = useMemo(() => buildWorkbenchCountsForFilters(leads, filters, clock), [clock, filters, leads]);
  const activeView = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const activeLeads = useMemo(
    () => sortWorkbenchLeads(filterWorkbenchLeads(filteredScopeLeads, activeTab, clock), activeTab),
    [activeTab, clock, filteredScopeLeads],
  );
  const totalQueuePages = useMemo(
    () => Math.max(1, Math.ceil(activeLeads.length / queuePageSize)),
    [activeLeads.length, queuePageSize],
  );
  const pageStartIndex = (queuePage - 1) * queuePageSize;
  const pagedActiveLeads = useMemo(
    () => activeLeads.slice(pageStartIndex, pageStartIndex + queuePageSize),
    [activeLeads, pageStartIndex, queuePageSize],
  );
  const activeLeadMap = useMemo(
    () => new Map(activeLeads.map((lead) => [lead.leadId, lead] as const)),
    [activeLeads],
  );
  const pagedLeadIds = useMemo(
    () => pagedActiveLeads.map((lead) => lead.leadId),
    [pagedActiveLeads],
  );
  const selectedLeads = useMemo(
    () =>
      selectedLeadIds
        .map((leadId) => activeLeadMap.get(leadId))
        .filter((lead): lead is LeadDoc => Boolean(lead)),
    [activeLeadMap, selectedLeadIds],
  );
  const isAllVisibleSelected = useMemo(
    () => pagedLeadIds.length > 0 && pagedLeadIds.every((leadId) => selectedLeadIds.includes(leadId)),
    [pagedLeadIds, selectedLeadIds],
  );
  const slaSummary = useMemo(
    () =>
      activeLeads.reduce(
        (totals, lead) => {
          const meta = getLeadSlaMeta(lead, clock);
          if (!meta) return totals;
          if (meta.bucket === "overdue") totals.overdue += 1;
          if (meta.bucket === "due_today") totals.dueToday += 1;
          return totals;
        },
        { overdue: 0, dueToday: 0 },
      ),
    [activeLeads, clock],
  );
  const nextLead = activeLeads[0] ?? null;
  const workbenchActions = new Set(crmLayout.workbenchActions);
  const scopeLabel = getWorkbenchScopeLabel(currentUser, scopeUids);
  const actionableNow = counts.new_leads + counts.due_today + counts.callbacks;
  const smartViewRail = smartViews.filter((view) => view.pinned || view.isDefault || view.visibility === "team_shared");
  const duplicateQueueLeads = useMemo(
    () => applyWorkbenchFilters(leads, { ...filters, status: "all" }, clock),
    [clock, filters, leads],
  );
  const duplicateGroups = useMemo(
    () => buildDuplicateLeadGroups(duplicateQueueLeads).slice(0, 8),
    [duplicateQueueLeads],
  );
  const canReviewDuplicates = canManageTeam(currentUser) || crmLayout.showLeadInspector;
  const activeDuplicateGroup = useMemo(
    () => duplicateGroups.find((group) => group.id === activeDuplicateGroupId) ?? null,
    [activeDuplicateGroupId, duplicateGroups],
  );
  const mergePrimaryLead = activeDuplicateGroup?.leads.find((lead) => lead.leadId === mergePrimaryLeadId) ?? activeDuplicateGroup?.leads[0] ?? null;
  const mergeDuplicateLead =
    activeDuplicateGroup?.leads.find((lead) => lead.leadId === mergeDuplicateLeadId) ??
    activeDuplicateGroup?.leads.find((lead) => lead.leadId !== mergePrimaryLead?.leadId) ??
    null;
  const mergePreview = useMemo(
    () =>
      mergePrimaryLead && mergeDuplicateLead
        ? buildLeadMergePreview({
            primary: mergePrimaryLead,
            duplicate: mergeDuplicateLead,
            strategy: mergeStrategy,
          })
        : [],
    [mergeDuplicateLead, mergePrimaryLead, mergeStrategy],
  );

  useEffect(() => {
    if (!activeDuplicateGroup) return;
    setMergePrimaryLeadId(activeDuplicateGroup.leads[0]?.leadId ?? "");
    setMergeDuplicateLeadId(activeDuplicateGroup.leads[1]?.leadId ?? "");
    setMergeStrategy("recent_non_empty");
    setMergeError(null);
  }, [activeDuplicateGroup]);

  const ownerOptions = useMemo(() => {
    const ownerIds = scopeUids === null
      ? Array.from(new Set(leads.map((lead) => lead.assignedTo ?? lead.ownerUid ?? null).filter((value): value is string => Boolean(value))))
      : Array.from(new Set(scopeUids.filter(Boolean)));
    return [{ value: "all", label: "All owners" }, ...ownerIds.map((uid) => ({ value: uid, label: getMemberLabel(uid, memberLookup) }))];
  }, [leads, memberLookup, scopeUids]);
  const assignableOwnerOptions = useMemo(
    () => ownerOptions.filter((option) => option.value !== "all"),
    [ownerOptions],
  );
  const canUseBatchFilter = canBulkImportLeads(currentUser);
  const batchFilterOptions = useMemo(() => {
    const byBatch = new Map<string, { count: number; source: string | null; updatedAtMs: number }>();
    leads.forEach((lead) => {
      const batchId = lead.importBatchId?.trim();
      if (!batchId) return;
      const current = byBatch.get(batchId) ?? { count: 0, source: null, updatedAtMs: 0 };
      const updatedAtMs =
        coerceDateValue(lead.updatedAt)?.getTime() ??
        coerceDateValue(lead.createdAt)?.getTime() ??
        0;
      byBatch.set(batchId, {
        count: current.count + 1,
        source: current.source ?? lead.source ?? null,
        updatedAtMs: Math.max(current.updatedAtMs, updatedAtMs),
      });
    });
    return Array.from(byBatch.entries())
      .sort((left, right) => right[1].updatedAtMs - left[1].updatedAtMs)
      .slice(0, 12)
      .map(([batchId, meta]) => ({
        value: batchId,
        label: `${batchId.slice(-8)} | ${meta.count}`,
        source: meta.source,
      }));
  }, [leads]);
  const sourceFilterOptions = useMemo(
    () =>
      ensureCurrentOption(
        buildTextFilterOptions(leads, (lead) => lead.source, 40),
        filters.source,
      ),
    [filters.source, leads],
  );
  const campaignFilterOptions = useMemo(
    () =>
      ensureCurrentOption(
        buildTextFilterOptions(leads, (lead) => lead.campaignName, 40),
        filters.campaignName,
      ),
    [filters.campaignName, leads],
  );
  const tagFilterOptions = useMemo(
    () => {
      const byTag = new Map<
        string,
        { value: string; count: number; updatedAtMs: number }
      >();
      leads.forEach((lead) => {
        const updatedAtMs =
          coerceDateValue(lead.updatedAt)?.getTime() ??
          coerceDateValue(lead.createdAt)?.getTime() ??
          0;
        [...(lead.leadTags ?? []), ...(lead.importTags ?? [])].forEach((rawTag) => {
          const tag = rawTag?.trim();
          if (!tag) return;
          const key = tag.toLowerCase();
          const existing = byTag.get(key) ?? {
            value: tag,
            count: 0,
            updatedAtMs: 0,
          };
          byTag.set(key, {
            value: existing.value,
            count: existing.count + 1,
            updatedAtMs: Math.max(existing.updatedAtMs, updatedAtMs),
          });
        });
      });

      const options = Array.from(byTag.entries())
        .sort((left, right) => {
          if (right[1].count !== left[1].count) return right[1].count - left[1].count;
          if (right[1].updatedAtMs !== left[1].updatedAtMs) {
            return right[1].updatedAtMs - left[1].updatedAtMs;
          }
          return left[1].value.localeCompare(right[1].value);
        })
        .slice(0, 60)
        .map(([, meta]) => ({
          value: meta.value,
          label: meta.value,
          count: meta.count,
        }));
      return ensureCurrentOption(options, filters.leadTag);
    },
    [filters.leadTag, leads],
  );
  const locationFilterOptions = useMemo(
    () =>
      ensureCurrentOption(
        buildTextFilterOptions(leads, (lead) => lead.leadLocation, 40),
        filters.leadLocation,
      ),
    [filters.leadLocation, leads],
  );
  const languageFilterOptions = useMemo(
    () =>
      ensureCurrentOption(
        buildTextFilterOptions(leads, (lead) => lead.preferredLanguage, 30),
        filters.preferredLanguage,
      ),
    [filters.preferredLanguage, leads],
  );

  useEffect(() => {
    setSelectedLeadIds((current) => current.filter((leadId) => activeLeadMap.has(leadId)));
  }, [activeLeadMap]);

  useEffect(() => {
    if (queuePage > totalQueuePages) {
      setQueuePage(totalQueuePages);
    }
  }, [queuePage, totalQueuePages]);

  useEffect(() => {
    setQueuePage(1);
  }, [activeTab, filters, queuePageSize]);

  useEffect(() => {
    const hasTarget = assignableOwnerOptions.some((option) => option.value === bulkAssignTargetUid);
    if (!hasTarget) {
      setBulkAssignTargetUid(assignableOwnerOptions[0]?.value ?? "");
    }
  }, [assignableOwnerOptions, bulkAssignTargetUid]);

  function setManualFilters(next: Partial<CrmWorkbenchFilters>) {
    setActiveSmartViewId(null);
    setFilters((current) => normalizeWorkbenchFilters({ ...current, ...next }));
  }

  function applyQuickSmartFilter(
    preset:
      | "due_today"
      | "overdue_followup"
      | "stale_3d"
      | "payment_stage"
      | "new_last_7_days"
      | "clear_activity",
  ) {
    const todayKey = toDateKey(clock);
    const sevenDaysAgoKey = toDateKey(addDays(clock, -6));
    switch (preset) {
      case "due_today":
        setManualFilters({ activityState: "due_today" });
        return;
      case "overdue_followup":
        setManualFilters({ activityState: "overdue_followup" });
        return;
      case "stale_3d":
        setManualFilters({ activityState: "stale_3d" });
        return;
      case "payment_stage":
        setManualFilters({ activityState: "payment_stage" });
        return;
      case "new_last_7_days":
        setManualFilters({
          createdFromDateKey: sevenDaysAgoKey,
          createdToDateKey: todayKey,
        });
        return;
      case "clear_activity":
        setManualFilters({
          activityState: "all",
          activityType: "all",
          createdFromDateKey: null,
          createdToDateKey: null,
          lastTouchFromDateKey: null,
          lastTouchToDateKey: null,
          followUpFromDateKey: null,
          followUpToDateKey: null,
        });
        return;
    }
  }

  function toggleLeadSelection(leadId: string) {
    setBulkAssignMessage(null);
    setSelectedLeadIds((current) =>
      current.includes(leadId)
        ? current.filter((value) => value !== leadId)
        : [...current, leadId],
    );
  }

  function toggleVisibleLeadSelection() {
    setBulkAssignMessage(null);
    setSelectedLeadIds((current) => {
      if (pagedLeadIds.length === 0) return current;
      if (isAllVisibleSelected) {
        return current.filter((leadId) => !pagedLeadIds.includes(leadId));
      }
      return Array.from(new Set([...current, ...pagedLeadIds]));
    });
  }

  function selectTopCountLeads() {
    const requested = Number.parseInt(bulkSelectCount, 10);
    if (!Number.isFinite(requested) || requested <= 0) {
      setBulkAssignMessage("Enter a valid lead count greater than 0.");
      return;
    }
    const topIds = activeLeads.slice(0, requested).map((lead) => lead.leadId);
    setSelectedLeadIds(topIds);
    setBulkAssignMessage(`Selected ${topIds.length} lead${topIds.length === 1 ? "" : "s"} from the current queue order.`);
  }

  function clearLeadSelection() {
    setSelectedLeadIds([]);
    setBulkAssignMessage(null);
  }

  function applySmartView(view: CrmSmartViewDoc) {
    setActiveSmartViewId(view.id);
    setActiveTab(view.baseTabId);
    setFilters(normalizeWorkbenchFilters(view.filters));
    setIsStudioOpen(false);
  }

  async function saveSmartView() {
    if (!db) return;
    const firestore = db;
    if (!draft.name.trim()) {
      setViewError("Give this Smart View a name.");
      return;
    }

    setSavingView(true);
    setViewError(null);
    try {
      const ref = ownedActiveSmartView ? doc(firestore, "crm_smart_views", ownedActiveSmartView.id) : doc(collection(firestore, "crm_smart_views"));
      const batch = writeBatch(firestore);

      if (draft.isDefault) {
        smartViews
          .filter((view) => view.ownerUid === currentUser.uid && view.id !== ref.id && view.isDefault)
          .forEach((view) => {
            batch.set(doc(firestore, "crm_smart_views", view.id), { isDefault: false, updatedAt: serverTimestamp() }, { merge: true });
          });
      }

      batch.set(ref, {
        id: ref.id,
        name: draft.name.trim(),
        ownerUid: currentUser.uid,
        ownerName: currentUser.displayName ?? currentUser.email ?? currentUser.uid,
        baseTabId: activeTab,
        filters: normalizeWorkbenchFilters(filters),
        pinned: draft.pinned,
        isDefault: draft.isDefault,
        visibility: draft.shareWithTeam && canPushTeamViews ? "team_shared" : "personal",
        sharedWithUserUids: draft.shareWithTeam && canPushTeamViews && scopeUids ? Array.from(new Set(scopeUids.filter((uid) => uid && uid !== currentUser.uid))) : [],
        updatedAt: serverTimestamp(),
        ...(ownedActiveSmartView ? {} : { createdAt: serverTimestamp() }),
      }, { merge: true });

      await batch.commit();
      setActiveSmartViewId(ref.id);
      setIsStudioOpen(false);
    } catch (error) {
      setViewError(error instanceof Error ? error.message : "Unable to save Smart View.");
    } finally {
      setSavingView(false);
    }
  }

  async function deleteSmartView() {
    if (!db || !ownedActiveSmartView) return;
    const firestore = db;
    setSavingView(true);
    try {
      await deleteDoc(doc(firestore, "crm_smart_views", ownedActiveSmartView.id));
      setActiveSmartViewId(null);
      setIsStudioOpen(false);
    } catch (error) {
      setViewError(error instanceof Error ? error.message : "Unable to delete Smart View.");
    } finally {
      setSavingView(false);
    }
  }

  async function handleMergeDuplicateGroup() {
    if (!mergePrimaryLead || !mergeDuplicateLead) {
      setMergeError("Select a survivor lead and a duplicate lead.");
      return;
    }

    setMergingDuplicate(true);
    setMergeError(null);
    try {
      const actor = buildLeadActor({
        uid: currentUser.uid,
        displayName: currentUser.displayName,
        email: currentUser.email,
        role: currentUser.role,
        orgRole: currentUser.orgRole ?? null,
        employeeId: currentUser.employeeId ?? null,
      });
      await mergeLeadIntoPrimary({
        primary: mergePrimaryLead,
        duplicate: mergeDuplicateLead,
        actor,
        strategy: mergeStrategy,
      });
      setActiveDuplicateGroupId(null);
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : "Unable to merge duplicate leads.");
    } finally {
      setMergingDuplicate(false);
    }
  }

  useEffect(() => {
    function editable(target: EventTarget | null) {
      return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "/" && !editable(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const index = Number.parseInt(event.key, 10) - 1;
      if (Number.isNaN(index) || index < 0 || index >= tabs.length) return;
      event.preventDefault();
      setActiveSmartViewId(null);
      setActiveTab(tabs[index].id);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tabs]);

  function addDays(base: Date, days: number) {
    const next = new Date(base);
    next.setDate(next.getDate() + days);
    return next;
  }

  function openLeadDetail(input: {
    lead: LeadDoc;
    section: CrmCommandSection;
    prefillOutcomeId?: LeadSopOutcomeId | null;
    prefillAssignmentReason?: string | null;
    prefillAssigneeUid?: string | null;
  }) {
    setDetailLead(input.lead);
    setDetailSection(input.section);
    setDetailPrefillOutcomeId(input.prefillOutcomeId ?? null);
    setDetailPrefillAssignmentReason(input.prefillAssignmentReason ?? null);
    setDetailPrefillAssigneeUid(input.prefillAssigneeUid ?? null);
  }

  function closeLeadDetail() {
    setDetailLead(null);
    setDetailPrefillOutcomeId(null);
    setDetailPrefillAssignmentReason(null);
    setDetailPrefillAssigneeUid(null);
  }

  async function handleQuickLeadAction(input: {
    lead: LeadDoc;
    action: "followup_push" | "close" | "reopen";
  }) {
    if (!currentUser?.uid) return;
    setQuickActionSavingLeadId(input.lead.leadId);
    setQuickActionMessage(null);
    try {
      if (input.action === "close") {
        await updateLeadStatusInDb(
          input.lead.leadId,
          "converted",
          "Quick close from CRM workbench",
          currentUser.uid,
          null,
        );
        setQuickActionMessage(`Closed ${toTitleCase(input.lead.name)} from CRM workbench.`);
        return;
      }

      const baseFollowUp = coerceDateValue(input.lead.nextFollowUp) ?? new Date();
      const nextFollowUp = addDays(baseFollowUp, 1);
      const remarks =
        input.action === "reopen"
          ? "Lead reopened from CRM workbench with next follow-up."
          : "Follow-up pushed by one day from CRM workbench.";

      await updateLeadStatusInDb(
        input.lead.leadId,
        "followup",
        remarks,
        currentUser.uid,
        nextFollowUp,
      );
      setQuickActionMessage(
        input.action === "reopen"
          ? `Reopened ${toTitleCase(input.lead.name)} and set follow-up for ${nextFollowUp.toLocaleDateString()}.`
          : `Pushed follow-up for ${toTitleCase(input.lead.name)} to ${nextFollowUp.toLocaleDateString()}.`,
      );
    } catch (error) {
      console.error("Quick CRM action failed", error);
      setQuickActionMessage(
        error instanceof Error ? error.message : "Quick CRM action failed.",
      );
    } finally {
      setQuickActionSavingLeadId(null);
    }
  }

  async function applyBulkAssignFromQueue() {
    if (!canUseBulkAssign) return;
    if (selectedLeads.length === 0) {
      setBulkAssignMessage("Select leads from the list first.");
      return;
    }
    if (!bulkAssignTargetUid) {
      setBulkAssignMessage("Choose an assignee.");
      return;
    }
    if (!bulkAssignReason.trim()) {
      setBulkAssignMessage("Transfer reason is mandatory for bulk assignment.");
      return;
    }

    setBulkAssignSaving(true);
    setBulkAssignMessage(null);
    try {
      const actor = buildLeadActor({
        uid: currentUser.uid,
        displayName: currentUser.displayName,
        email: currentUser.email,
        role: currentUser.role,
        orgRole: currentUser.orgRole ?? null,
        employeeId: currentUser.employeeId ?? null,
      });
      const result = await applyBulkLeadActions({
        leads: selectedLeads,
        actor,
        assignTo: bulkAssignTargetUid,
        transferReason: bulkAssignReason.trim(),
        remarks: "Bulk assignment from CRM leads queue",
      });
      setBulkAssignMessage(
        [
          `Assigned ${result.updated} lead${result.updated === 1 ? "" : "s"}.`,
          result.batchId ? `Batch: ${result.batchId}` : null,
          result.writeFailures.length
            ? `${result.writeFailures.length} write failure${result.writeFailures.length === 1 ? "" : "s"} logged.`
            : null,
          result.sideEffectFailures.length
            ? `${result.sideEffectFailures.length} post-write sync failure${result.sideEffectFailures.length === 1 ? "" : "s"} logged.`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      setSelectedLeadIds([]);
    } catch (error) {
      console.error("CRM bulk assign failed", error);
      setBulkAssignMessage(
        error instanceof Error ? error.message : "CRM bulk assign failed.",
      );
    } finally {
      setBulkAssignSaving(false);
    }
  }

  const renderLeadActions = (lead: LeadDoc, compact = false) => {
    const leadOwnerUid = lead.assignedTo ?? lead.ownerUid ?? "";
    const canPullBackToSelf =
      workbenchActions.has("reassign") && currentUser.uid !== leadOwnerUid;
    const secondaryActionClass = compact
      ? "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border px-2 text-xs font-semibold shadow-sm"
      : "inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium shadow-sm sm:flex-none";
    const primaryActionClass = compact
      ? "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg bg-slate-900 px-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
      : "inline-flex items-center justify-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 sm:flex-none";
    const compactIconClass = compact ? "h-3.5 w-3.5" : "h-4 w-4";
    const iconSpacingClass = compact ? "" : "mr-2";
    return (
      <>
        {workbenchActions.has("call") ? (
          <a
            href={lead.phone ? `tel:${lead.phone}` : "#"}
            className={`${secondaryActionClass} ${
              lead.phone
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "pointer-events-none border-slate-200 bg-slate-100 text-slate-400"
            }`}
            aria-label={`Call ${toTitleCase(lead.name)}`}
          >
            <PhoneIcon className={`${compactIconClass} ${iconSpacingClass}`} />
            Call
          </a>
        ) : null}
        {workbenchActions.has("whatsapp") ? (
          <a
            href={lead.phone ? `https://wa.me/${lead.phone.replace(/\D/g, "")}` : "#"}
            target="_blank"
            rel="noreferrer"
            className={`${secondaryActionClass} ${
              lead.phone
                ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                : "pointer-events-none border-slate-200 bg-slate-100 text-slate-400"
            }`}
            aria-label={`Message ${toTitleCase(lead.name)} on WhatsApp`}
          >
            WA
          </a>
        ) : null}
        {workbenchActions.has("update") ? (
          <button
            type="button"
            onClick={() =>
              openLeadDetail({
                lead,
                section: "status",
                prefillOutcomeId: getDefaultSopOutcomeForWorkbenchTab(activeTab),
              })
            }
            className={primaryActionClass}
            aria-label={`Log outcome for ${toTitleCase(lead.name)}`}
          >
            {compact ? "Log" : "Log outcome"}
          </button>
        ) : null}
        {workbenchActions.has("reassign") ? (
          <button
            type="button"
            onClick={() =>
              openLeadDetail({
                lead,
                section: "assignment",
                prefillAssignmentReason: getAssignmentReasonTemplate(
                  DEFAULT_REASSIGN_REASON_TEMPLATE_ID,
                ).text,
              })
            }
            className={`${secondaryActionClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
            aria-label={`Reassign ${toTitleCase(lead.name)}`}
          >
            <UserPlusIcon className={`${compactIconClass} ${iconSpacingClass}`} />
            {compact ? "Assign" : "Reassign"}
          </button>
        ) : null}
        {canPullBackToSelf ? (
          <button
            type="button"
            onClick={() =>
              openLeadDetail({
                lead,
                section: "assignment",
                prefillAssigneeUid: currentUser.uid,
                prefillAssignmentReason: getAssignmentReasonTemplate(
                  DEFAULT_PULLBACK_REASON_TEMPLATE_ID,
                ).text,
              })
            }
            className={`${secondaryActionClass} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}
            aria-label={`Pull back ${toTitleCase(lead.name)}`}
          >
            {compact ? "Pull" : "Pullback"}
          </button>
        ) : null}
        {workbenchActions.has("update") ? (
          <button
            type="button"
            onClick={() => void handleQuickLeadAction({ lead, action: "followup_push" })}
            disabled={quickActionSavingLeadId === lead.leadId}
            className={`${secondaryActionClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60`}
            aria-label={`Push follow-up for ${toTitleCase(lead.name)} by one day`}
          >
            {quickActionSavingLeadId === lead.leadId
              ? "Saving..."
              : compact
                ? "+1d"
                : "Follow-up +1d"}
          </button>
        ) : null}
        {workbenchActions.has("update") ? (
          <button
            type="button"
            onClick={() =>
              void handleQuickLeadAction({
                lead,
                action: ["closed", "converted"].includes(normalizeLeadStatus(lead.status))
                  ? "reopen"
                  : "close",
              })}
            disabled={quickActionSavingLeadId === lead.leadId}
            className={`${secondaryActionClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60`}
            aria-label={`${["closed", "converted"].includes(normalizeLeadStatus(lead.status)) ? "Reopen" : "Close"} ${toTitleCase(lead.name)}`}
          >
            {quickActionSavingLeadId === lead.leadId
              ? "Saving..."
              : ["closed", "converted"].includes(normalizeLeadStatus(lead.status))
                ? "Reopen"
                : "Close"}
          </button>
        ) : null}
        {workbenchActions.has("details") ? (
          <button
            type="button"
            onClick={() =>
              openLeadDetail({
                lead,
                section: crmLayout.defaultSection,
              })
            }
            className={`${secondaryActionClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
            aria-label={`Open details for ${toTitleCase(lead.name)}`}
          >
            <EyeIcon className={`${compactIconClass} ${iconSpacingClass}`} />
            {compact ? "Open" : "Details"}
          </button>
        ) : null}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-[28px] border border-slate-200/70 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.16),_transparent_36%),linear-gradient(135deg,_#ffffff,_#f8fafc)] px-5 py-4 sm:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-700">Smart Views</div>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{heading}</h1>
              <p className="mt-1 max-w-2xl text-xs text-slate-600 sm:text-sm">{description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-medium text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />Live updates</span>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 font-medium text-slate-600">{scopeLabel}</span>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 font-medium text-slate-600"><ArrowPathIcon className="h-3.5 w-3.5" />{lastSyncedAt ? `Updated ${formatDistanceToNow(lastSyncedAt, { addSuffix: true })}` : "Waiting for sync"}</span>
              <button
                type="button"
                onClick={() => setInsightsOpen((current) => !current)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50"
              >
                {insightsOpen ? "Hide insights" : "Show insights"}
              </button>
            </div>
          </div>

          {insightsOpen ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">In Scope</div><div className="mt-2 text-2xl font-semibold text-slate-900">{filteredScopeLeads.length}</div><div className="mt-1 text-sm text-slate-500">{scopeUids === null ? "Live leads across this filtered queue." : `Recent live window capped per owner stream (${SCOPED_QUERY_LIMIT}).`}</div></div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Actionable Now</div><div className="mt-2 text-2xl font-semibold text-slate-900">{actionableNow}</div><div className="mt-1 text-sm text-slate-500">New, due-today, and callback work after filters.</div></div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Smart View</div><div className="mt-2 text-lg font-semibold text-slate-900">{activeSmartView?.name ?? activeView.label}</div><div className="mt-1 text-sm text-slate-500">{activeSmartView ? `${getSmartViewBadge(activeSmartView, currentUser.uid)} | ${activeView.label}` : "Role-based fallback view"}</div></div>
          </div>
          ) : null}
        </div>

        <div className="border-t border-slate-200/70 px-5 py-4 sm:px-7">
          {quickActionMessage ? (
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {quickActionMessage}
            </div>
          ) : null}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-lg flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input ref={searchRef} type="text" value={filters.searchTerm} onChange={(event) => setManualFilters({ searchTerm: event.target.value })} placeholder="Search by name, phone, email, lead ID, source, campaign, location, language, batch tag, or lead tag..." className="w-full rounded-xl border border-slate-200 bg-white px-10 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">`/` search | `Alt+1-${tabs.length}` tabs</div>
              <div className="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => setLayoutMode("cards")}
                  className={`px-3 py-2 text-xs font-semibold ${layoutMode === "cards" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  Cards
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode("compact")}
                  className={`px-3 py-2 text-xs font-semibold ${layoutMode === "compact" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  Queue
                </button>
              </div>
              {allowCreateLead ? (
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(true)}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Add lead
                </button>
              ) : null}
              {allowImport ? (
                <button
                  type="button"
                  onClick={() => setIsImportOpen(true)}
                  className="inline-flex items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-100"
                >
                  Import leads
                </button>
              ) : null}
              <button type="button" onClick={() => setIsStudioOpen((current) => !current)} className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"><BookmarkIcon className="mr-2 h-4 w-4" />{ownedActiveSmartView ? "Edit view" : "Save view"}</button>
              {nextLead ? <button type="button" onClick={() => openLeadDetail({ lead: nextLead, section: crmLayout.defaultSection })} className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">Open top lead</button> : null}
            </div>
          </div>
          {canUseBatchFilter ? (
            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Batch Filter</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {filters.importBatchId && filters.importBatchId !== "all"
                      ? `Focused on ${filters.importBatchId}`
                      : "No batch focus applied"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {filters.importBatchId && filters.importBatchId !== "all" ? (
                    <button
                      type="button"
                      onClick={() => setManualFilters({ importBatchId: "all" })}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      Clear batch
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setBatchFilterOpen((current) => !current)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {batchFilterOpen ? "Hide batches" : "Show batches"}
                  </button>
                </div>
              </div>
              {batchFilterOpen ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setManualFilters({ importBatchId: "all" })}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      !filters.importBatchId || filters.importBatchId === "all"
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    All batches
                  </button>
                  {batchFilterOptions.length === 0 ? (
                    <span className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-500">
                      No import batches in this scope yet
                    </span>
                  ) : (
                    batchFilterOptions.map((batchOption) => (
                      <button
                        key={batchOption.value}
                        type="button"
                        onClick={() => setManualFilters({ importBatchId: batchOption.value })}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          filters.importBatchId === batchOption.value
                            ? "border-indigo-700 bg-indigo-700 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                        title={batchOption.source ? `${batchOption.source} | ${batchOption.value}` : batchOption.value}
                      >
                        {batchOption.label}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-200/70 px-5 py-4 sm:px-7">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Smart filters</div>
                <div className="mt-1 text-xs text-slate-500">
                  Apply activity and date presets in one click, then fine-tune below.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAdvancedFiltersOpen((current) => !current)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {advancedFiltersOpen ? "Hide advanced" : "Show advanced"}
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickSmartFilter("due_today")}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    filters.activityState === "due_today"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  Due today
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickSmartFilter("overdue_followup")}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    filters.activityState === "overdue_followup"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  Overdue
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickSmartFilter("stale_3d")}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    filters.activityState === "stale_3d"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  Stale 3d
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickSmartFilter("payment_stage")}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    filters.activityState === "payment_stage"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  Payment stage
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickSmartFilter("new_last_7_days")}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    Boolean(filters.createdFromDateKey || filters.createdToDateKey)
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  New in 7 days
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickSmartFilter("clear_activity")}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Clear activity/date
                </button>
              </div>
            </div>

            {advancedFiltersOpen ? (
            <>
            <div className="grid gap-3 lg:grid-cols-4">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status focus</span>
                <select
                  value={filters.status}
                  onChange={(event) => setManualFilters({ status: event.target.value as CrmWorkbenchFilters["status"] })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {ownerOptions.length > 1 ? (
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Owner focus</span>
                  <select
                    value={filters.ownerUid}
                    onChange={(event) => setManualFilters({ ownerUid: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  >
                    {ownerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div />
              )}
              {canUseBatchFilter ? (
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Batch focus</span>
                  <select
                    value={filters.importBatchId ?? "all"}
                    onChange={(event) => setManualFilters({ importBatchId: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  >
                    <option value="all">All batches</option>
                    {batchFilterOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div />
              )}
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Activity state</span>
                <select
                  value={filters.activityState ?? "all"}
                  onChange={(event) =>
                    setManualFilters({
                      activityState: event.target.value as CrmWorkbenchFilters["activityState"],
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                >
                  {activityStateOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 lg:grid-cols-4">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Last activity type</span>
                <select
                  value={filters.activityType ?? "all"}
                  onChange={(event) =>
                    setManualFilters({
                      activityType: event.target.value as CrmWorkbenchFilters["activityType"],
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                >
                  {activityTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source</span>
                <select
                  value={filters.source ?? "all"}
                  onChange={(event) => setManualFilters({ source: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                >
                  <option value="all">All sources</option>
                  {sourceFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.count ? `${option.label} (${option.count})` : option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Campaign</span>
                <select
                  value={filters.campaignName ?? "all"}
                  onChange={(event) => setManualFilters({ campaignName: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                >
                  <option value="all">All campaigns</option>
                  {campaignFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.count ? `${option.label} (${option.count})` : option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tag</span>
                <select
                  value={filters.leadTag ?? "all"}
                  onChange={(event) => setManualFilters({ leadTag: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                >
                  <option value="all">All tags</option>
                  {tagFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.count ? `${option.label} (${option.count})` : option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 lg:grid-cols-4">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Location</span>
                <select
                  value={filters.leadLocation ?? "all"}
                  onChange={(event) => setManualFilters({ leadLocation: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                >
                  <option value="all">All locations</option>
                  {locationFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.count ? `${option.label} (${option.count})` : option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Language</span>
                <select
                  value={filters.preferredLanguage ?? "all"}
                  onChange={(event) => setManualFilters({ preferredLanguage: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                >
                  <option value="all">All languages</option>
                  {languageFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.count ? `${option.label} (${option.count})` : option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Created from</span>
                <input
                  type="date"
                  value={filters.createdFromDateKey ?? ""}
                  onChange={(event) => setManualFilters({ createdFromDateKey: event.target.value || null })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Created to</span>
                <input
                  type="date"
                  value={filters.createdToDateKey ?? ""}
                  onChange={(event) => setManualFilters({ createdToDateKey: event.target.value || null })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
              </label>
            </div>

            <div className="grid gap-3 lg:grid-cols-4">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Last touch from</span>
                <input
                  type="date"
                  value={filters.lastTouchFromDateKey ?? ""}
                  onChange={(event) => setManualFilters({ lastTouchFromDateKey: event.target.value || null })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Last touch to</span>
                <input
                  type="date"
                  value={filters.lastTouchToDateKey ?? ""}
                  onChange={(event) => setManualFilters({ lastTouchToDateKey: event.target.value || null })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Follow-up from</span>
                <input
                  type="date"
                  value={filters.followUpFromDateKey ?? ""}
                  onChange={(event) => setManualFilters({ followUpFromDateKey: event.target.value || null })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Follow-up to</span>
                <input
                  type="date"
                  value={filters.followUpToDateKey ?? ""}
                  onChange={(event) => setManualFilters({ followUpToDateKey: event.target.value || null })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
              </label>
            </div>

            <div className="flex items-end justify-start lg:justify-end">
              <button
                type="button"
                onClick={() => {
                  setActiveSmartViewId(null);
                  setFilters(getDefaultWorkbenchFilters());
                }}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Reset filters
              </button>
            </div>
            </>
            ) : null}
          </div>
        </div>

        <div className="border-t border-slate-200/70 px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Pinned Filters</div>
              <div className="text-xs text-slate-500">Personal shortcuts and manager-pushed team views.</div>
            </div>
            <div className="flex items-center gap-2">
              {smartViewsError ? <div className="text-xs text-rose-600">{smartViewsError.message}</div> : null}
              <button
                type="button"
                onClick={() => setSmartViewsOpen((current) => !current)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {smartViewsOpen ? "Hide views" : "Show views"}
              </button>
            </div>
          </div>
          {smartViewsOpen ? (
            smartViewsLoading ? (
              <div className="mt-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">Loading saved Smart Views...</div>
            ) : smartViewRail.length === 0 ? (
              <div className="mt-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">Save the current queue as a Smart View to pin filters and share them with your team.</div>
            ) : (
              <div className="mt-2 flex snap-x gap-3 overflow-x-auto pb-2">
                {smartViewRail.map((view) => (
                  <button key={view.id} type="button" onClick={() => applySmartView(view)} className={`min-w-[220px] shrink-0 snap-start rounded-2xl border px-4 py-3 text-left transition ${view.id === activeSmartViewId ? "border-slate-900 bg-slate-900 text-white shadow-lg" : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{view.name}</div>
                        <div className={`mt-1 text-xs ${view.id === activeSmartViewId ? "text-slate-200" : "text-slate-500"}`}>{tabs.find((tab) => tab.id === view.baseTabId)?.label ?? "Smart View"}</div>
                      </div>
                      <BookmarkIcon className={`h-4 w-4 shrink-0 ${view.id === activeSmartViewId ? "text-white" : "text-slate-400"}`} />
                    </div>
                    <div className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${view.id === activeSmartViewId ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"}`}>{getSmartViewBadge(view, currentUser.uid)}</div>
                  </button>
                ))}
              </div>
            )
          ) : null}
        </div>

        {isStudioOpen ? (
          <div className="border-t border-slate-200/70 bg-slate-50/80 px-5 py-5 sm:px-7">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="space-y-4">
                <div><div className="text-sm font-semibold text-slate-900">Smart View Studio</div><div className="mt-1 text-sm text-slate-500">Save the current tab, filters, and search so BDAs and managers can reopen the same queue in one click.</div></div>
                <label className="block"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">View name</span><input type="text" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Example: Morning follow-up queue" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"><input type="checkbox" checked={draft.pinned} onChange={(event) => setDraft((current) => ({ ...current, pinned: event.target.checked }))} className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /><span><span className="block text-sm font-semibold text-slate-900">Pin to workbench</span><span className="mt-1 block text-xs text-slate-500">Keep this view in the pinned filter rail.</span></span></label>
                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"><input type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))} className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /><span><span className="block text-sm font-semibold text-slate-900">Default landing view</span><span className="mt-1 block text-xs text-slate-500">Override the role fallback and open this view first.</span></span></label>
                </div>
                {canPushTeamViews ? <label className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3"><input type="checkbox" checked={draft.shareWithTeam} onChange={(event) => setDraft((current) => ({ ...current, shareWithTeam: event.target.checked }))} className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /><span><span className="block text-sm font-semibold text-slate-900">Push to my team</span><span className="mt-1 block text-xs text-slate-600">Recipients in this CRM scope will see this as a shared Smart View.</span></span></label> : null}
                {viewError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{viewError}</div> : null}
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Captured filters</div>
                <div className="mt-3 space-y-3 text-sm text-slate-700">
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Base queue</span><span className="font-medium text-slate-900">{activeView.label}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Status</span><span className="font-medium text-slate-900">{statusOptions.find((option) => option.value === filters.status)?.label ?? "All statuses"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Activity state</span><span className="font-medium text-slate-900">{activityStateOptions.find((option) => option.value === (filters.activityState ?? "all"))?.label ?? "All activity states"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Activity type</span><span className="font-medium text-slate-900">{activityTypeOptions.find((option) => option.value === (filters.activityType ?? "all"))?.label ?? "All activity types"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Owner</span><span className="font-medium text-slate-900">{ownerOptions.find((option) => option.value === filters.ownerUid)?.label ?? "All owners"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Batch</span><span className="font-medium text-slate-900">{filters.importBatchId && filters.importBatchId !== "all" ? filters.importBatchId : "All batches"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Source</span><span className="font-medium text-slate-900">{filters.source && filters.source !== "all" ? filters.source : "All sources"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Campaign</span><span className="font-medium text-slate-900">{filters.campaignName && filters.campaignName !== "all" ? filters.campaignName : "All campaigns"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Tag</span><span className="font-medium text-slate-900">{filters.leadTag && filters.leadTag !== "all" ? filters.leadTag : "All tags"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Location</span><span className="font-medium text-slate-900">{filters.leadLocation && filters.leadLocation !== "all" ? filters.leadLocation : "All locations"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Language</span><span className="font-medium text-slate-900">{filters.preferredLanguage && filters.preferredLanguage !== "all" ? filters.preferredLanguage : "All languages"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Created date</span><span className="font-medium text-slate-900">{formatDateWindow(filters.createdFromDateKey, filters.createdToDateKey)}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Last touch date</span><span className="font-medium text-slate-900">{formatDateWindow(filters.lastTouchFromDateKey, filters.lastTouchToDateKey)}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Follow-up date</span><span className="font-medium text-slate-900">{formatDateWindow(filters.followUpFromDateKey, filters.followUpToDateKey)}</span></div>
                  <div className="flex items-start justify-between gap-3"><span className="text-slate-500">Search</span><span className="text-right font-medium text-slate-900">{filters.searchTerm.trim() || "No search term"}</span></div>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={saveSmartView} disabled={savingView} className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60">{savingView ? "Saving..." : ownedActiveSmartView ? "Update view" : "Save view"}</button>
                  {ownedActiveSmartView ? <button type="button" onClick={deleteSmartView} disabled={savingView} className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-50 disabled:opacity-60"><TrashIcon className="mr-2 h-4 w-4" />Delete</button> : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="border-t border-slate-200/70 px-4 py-4 sm:px-6">
          <div className="flex snap-x gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-3 lg:overflow-visible lg:pb-0 xl:grid-cols-6">
            {tabs.map((tab) => {
              const TabIcon = getTabIcon(tab.id);
              const isActive = tab.id === activeTab;
              return <button key={tab.id} type="button" onClick={() => { setActiveSmartViewId(null); setActiveTab(tab.id); }} className={`min-w-[220px] shrink-0 snap-start rounded-2xl border px-4 py-4 text-left transition lg:min-w-0 ${isActive ? "border-slate-900 bg-slate-900 text-white shadow-lg" : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"}`}><div className="flex items-center justify-between gap-3"><TabIcon className={`h-5 w-5 ${isActive ? "text-white" : "text-slate-500"}`} /><span className={`text-2xl font-semibold ${isActive ? "text-white" : "text-slate-900"}`}>{counts[tab.id]}</span></div><div className={`mt-4 text-sm font-semibold ${isActive ? "text-white" : "text-slate-900"}`}>{tab.label}</div><div className={`mt-1 text-xs leading-5 ${isActive ? "text-slate-200" : "text-slate-500"}`}>{tab.description}</div></button>;
            })}
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200/70 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div><div className="text-lg font-semibold text-slate-900">{activeSmartView?.name ?? activeView.label}</div><div className="mt-1 text-sm text-slate-500">{activeSmartView ? `${activeView.description} | ${activeLeads.length} live lead(s) matching this Smart View` : `${activeView.description} | ${counts[activeTab]} live lead(s)`}</div></div>
          <div className="flex flex-wrap items-center gap-2"><div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">Action-first queue</div>{slaSummary.overdue > 0 ? <div className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">{slaSummary.overdue} overdue</div> : null}{slaSummary.dueToday > 0 ? <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{slaSummary.dueToday} due today</div> : null}{nextLead ? <button type="button" onClick={() => openLeadDetail({ lead: nextLead, section: crmLayout.defaultSection })} className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50">Next lead</button> : null}</div>
        </div>

        <div className="border-b border-slate-200 px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-500">
              Page {queuePage} of {totalQueuePages} | {activeLeads.length} lead
              {activeLeads.length === 1 ? "" : "s"} in queue
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={String(queuePageSize)}
                onChange={(event) => setQueuePageSize(Number(event.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700"
              >
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </select>
              <button
                type="button"
                onClick={() => setQueuePage((current) => Math.max(1, current - 1))}
                disabled={queuePage === 1}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setQueuePage((current) => Math.min(totalQueuePages, current + 1))}
                disabled={queuePage === totalQueuePages}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>

          {canUseBulkAssign ? (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                  {selectedLeadIds.length} selected
                </div>
                <button
                  type="button"
                  onClick={toggleVisibleLeadSelection}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {isAllVisibleSelected ? "Unselect visible" : "Select visible"}
                </button>
                <button
                  type="button"
                  onClick={clearLeadSelection}
                  disabled={selectedLeadIds.length === 0}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  Clear
                </button>
                <input
                  type="number"
                  min="1"
                  value={bulkSelectCount}
                  onChange={(event) => setBulkSelectCount(event.target.value)}
                  className="w-24 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700"
                />
                <button
                  type="button"
                  onClick={selectTopCountLeads}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                >
                  Select top N
                </button>
                <select
                  value={bulkAssignTargetUid}
                  onChange={(event) => setBulkAssignTargetUid(event.target.value)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700"
                >
                  {assignableOwnerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={bulkAssignReason}
                  onChange={(event) => setBulkAssignReason(event.target.value)}
                  placeholder="Transfer reason"
                  className="min-w-[220px] flex-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700"
                />
                <button
                  type="button"
                  onClick={() => void applyBulkAssignFromQueue()}
                  disabled={bulkAssignSaving || selectedLeads.length === 0}
                  className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {bulkAssignSaving ? "Assigning..." : "Bulk assign"}
                </button>
              </div>
              {bulkAssignMessage ? (
                <div className="mt-2 text-xs text-slate-600">{bulkAssignMessage}</div>
              ) : null}
            </div>
          ) : null}
        </div>

        {loading ? <div className="px-7 py-16 text-sm text-slate-500">Loading the live CRM queue...</div> : error ? <div className="px-7 py-16 text-sm text-rose-600">{error.message}</div> : activeLeads.length === 0 ? <div className="px-7 py-16 text-center"><div className="text-lg font-semibold text-slate-900">{activeView.emptyTitle}</div><div className="mt-2 text-sm text-slate-500">{activeView.emptyMessage}</div></div> : layoutMode === "compact" ? (
          <div className="px-4 py-4 sm:px-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm text-slate-500">Compact queue mode keeps the old lead-list behavior inside the consolidated CRM.</div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                {pagedActiveLeads.length} of {activeLeads.length}
              </div>
            </div>
            <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 md:block">
              <table className="min-w-full divide-y divide-slate-200 bg-white">
                <thead className="bg-slate-50">
                  <tr>
                    {canUseBulkAssign ? (
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <input
                          type="checkbox"
                          checked={isAllVisibleSelected}
                          onChange={toggleVisibleLeadSelection}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          aria-label="Select visible leads"
                        />
                      </th>
                    ) : null}
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lead</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Context</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Owner / Status</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Action Clock</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {pagedActiveLeads.map((lead) => {
                    const timeMeta = getLeadTimeMeta(lead, activeTab);
                    const assigneeLabel = getMemberLabel(lead.assignedTo ?? lead.ownerUid ?? null, memberLookup);
                    const timeValue = timeMeta.date ? formatDistanceToNow(timeMeta.date, { addSuffix: true }) : "No timestamp";
                    const slaMeta = getLeadSlaMeta(lead, clock);
                    return (
                      <tr key={lead.leadId} className="align-middle hover:bg-slate-50">
                        {canUseBulkAssign ? (
                          <td className="px-4 py-2.5">
                            <input
                              type="checkbox"
                              checked={selectedLeadIds.includes(lead.leadId)}
                              onChange={() => toggleLeadSelection(lead.leadId)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              aria-label={`Select lead ${lead.leadId}`}
                            />
                          </td>
                        ) : null}
                        <td className="px-4 py-2.5">
                          <div className="max-w-[340px] truncate text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">{toTitleCase(lead.name)}</span>
                            <span className="mx-1.5 text-slate-300">|</span>
                            <span>{lead.phone ?? "No phone"}</span>
                            {lead.email ? (
                              <>
                                <span className="mx-1.5 text-slate-300">|</span>
                                <span>{lead.email}</span>
                              </>
                            ) : null}
                            <span className="mx-1.5 text-slate-300">|</span>
                            <span className="font-mono text-[11px] text-slate-500">{lead.leadId}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="max-w-[280px] truncate text-sm text-slate-700">
                            <span className="font-medium text-slate-900">{getLeadActionHint(lead, activeTab)}</span>
                            <span className="mx-1.5 text-slate-300">|</span>
                            <span>{getLeadPrimaryContext(lead)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex max-w-[320px] items-center gap-1.5 overflow-hidden whitespace-nowrap text-sm">
                            <span className="truncate font-medium text-slate-900">{assigneeLabel}</span>
                            <span className="inline-flex shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{getLeadStatusLabel(lead.status)}</span>
                            {(lead.statusDetail?.currentReason || lead.subStatus) ? <span className="inline-flex shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">{lead.statusDetail?.currentReason ?? lead.subStatus}</span> : null}
                            {slaMeta ? <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${slaMeta.badgeClassName}`}>{slaMeta.label}</span> : null}
                            {(lead.leadTags ?? []).slice(0, 1).map((tag, index) => <span key={`${lead.leadId}-table-tag-${tag}-${index}`} className="inline-flex shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{tag}</span>)}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="whitespace-nowrap text-sm text-slate-700">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{timeMeta.label}</span>
                            <span className="ml-1 text-slate-900">{timeValue}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-nowrap items-center justify-end gap-1 whitespace-nowrap">
                            {renderLeadActions(lead, true)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {pagedActiveLeads.map((lead) => {
                const timeMeta = getLeadTimeMeta(lead, activeTab);
                const timeValue = timeMeta.date ? formatDistanceToNow(timeMeta.date, { addSuffix: true }) : "No timestamp";
                const slaMeta = getLeadSlaMeta(lead, clock);
                return (
                  <article key={lead.leadId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        {canUseBulkAssign ? (
                          <input
                            type="checkbox"
                            checked={selectedLeadIds.includes(lead.leadId)}
                            onChange={() => toggleLeadSelection(lead.leadId)}
                            className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            aria-label={`Select lead ${lead.leadId}`}
                          />
                        ) : null}
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{toTitleCase(lead.name)}</div>
                          <div className="mt-1 text-sm text-slate-600">{lead.phone ?? "No phone"}</div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1"><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{getLeadStatusLabel(lead.status)}</span>{slaMeta ? <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${slaMeta.badgeClassName}`}>{slaMeta.label}</span> : null}</div>
                    </div>
                    <div className="mt-3 text-sm text-slate-600">{getLeadPrimaryContext(lead)}</div>
                    {(lead.leadTags ?? []).length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{(lead.leadTags ?? []).slice(0, 3).map((tag, index) => <span key={`${lead.leadId}-mobile-tag-${tag}-${index}`} className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{tag}</span>)}</div> : null}
                    <div className="mt-3 text-xs text-slate-500">{timeMeta.label}: {timeValue}</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {renderLeadActions(lead, true)}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : <div className="space-y-4 px-4 py-4 sm:px-6">{pagedActiveLeads.map((lead) => {
          const timeMeta = getLeadTimeMeta(lead, activeTab);
          const assigneeLabel = getMemberLabel(lead.assignedTo ?? lead.ownerUid ?? null, memberLookup);
          const timeValue = timeMeta.date ? formatDistanceToNow(timeMeta.date, { addSuffix: true }) : "No timestamp";
          const slaMeta = getLeadSlaMeta(lead, clock);

          return (
            <article key={lead.leadId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">{canUseBulkAssign ? <input type="checkbox" checked={selectedLeadIds.includes(lead.leadId)} onChange={() => toggleLeadSelection(lead.leadId)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" aria-label={`Select lead ${lead.leadId}`} /> : null}<h3 className="text-base font-semibold text-slate-900">{toTitleCase(lead.name)}</h3><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{getLeadStatusLabel(lead.status)}</span>{(lead.statusDetail?.currentReason || lead.subStatus) ? <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">{lead.statusDetail?.currentReason ?? lead.subStatus}</span> : null}{slaMeta ? <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${slaMeta.badgeClassName}`}>{slaMeta.label}</span> : null}{(lead.leadTags ?? []).slice(0, 3).map((tag, index) => <span key={`${lead.leadId}-card-tag-${tag}-${index}`} className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">{tag}</span>)}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600"><span>{lead.phone ?? "No phone"}</span><span>{lead.email ?? "No email"}</span></div>
                  <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700"><div className="font-medium text-slate-900">{getLeadActionHint(lead, activeTab)}</div><div className="mt-1 text-slate-600">{getLeadPrimaryContext(lead)}</div></div>
                  <div className="mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 px-3 py-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Owner</div><div className="mt-1 truncate text-slate-900">{assigneeLabel}</div></div><div className="rounded-xl border border-slate-200 px-3 py-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{timeMeta.label}</div><div className="mt-1 text-slate-900">{timeValue}</div></div><div className="rounded-xl border border-slate-200 px-3 py-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lead ID</div><div className="mt-1 truncate font-mono text-slate-900">{lead.leadId}</div></div></div>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:w-[260px] lg:justify-end">
                  {renderLeadActions(lead)}
                </div>
              </div>
            </article>
          );
        })}</div>}
      </section>

      {canReviewDuplicates ? (
        <section className="overflow-hidden rounded-[28px] border border-slate-200/70 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <div className="border-b border-slate-200/70 px-4 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Duplicate Review Queue</div>
                <div className="text-xs text-slate-500">Review likely duplicate leads inside this CRM scope before they waste BDA effort.</div>
              </div>
              <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                {duplicateGroups.length} live group{duplicateGroups.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <div className="px-4 py-4 sm:px-6">
            {duplicateGroups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                No duplicate groups are currently visible in this scope.
              </div>
            ) : (
              <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-3">
                  {duplicateGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => setActiveDuplicateGroupId(group.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${activeDuplicateGroupId === group.id ? "border-slate-900 bg-slate-900 text-white shadow-lg" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">
                            {group.leads.map((lead) => toTitleCase(lead.name)).join(" / ")}
                          </div>
                          <div className={`mt-1 text-xs ${activeDuplicateGroupId === group.id ? "text-slate-200" : "text-slate-500"}`}>
                            {group.reasons.join(" | ")}
                          </div>
                        </div>
                        <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${activeDuplicateGroupId === group.id ? "bg-white/15 text-white" : "bg-amber-50 text-amber-700"}`}>
                          Score {group.score}
                        </div>
                      </div>
                      <div className={`mt-3 flex flex-wrap gap-2 text-[11px] ${activeDuplicateGroupId === group.id ? "text-slate-200" : "text-slate-500"}`}>
                        {group.leads.map((lead) => (
                          <span key={lead.leadId} className={`rounded-full px-2.5 py-1 ${activeDuplicateGroupId === group.id ? "bg-white/10" : "bg-slate-100"}`}>
                            #{lead.leadId.slice(-6)} | {getLeadStatusLabel(lead.status)}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  {activeDuplicateGroup && mergePrimaryLead && mergeDuplicateLead ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Merge Console</div>
                          <div className="mt-1 text-xs text-slate-500">Choose the survivor, review conflicts, and merge without deleting history.</div>
                        </div>
                        <button type="button" onClick={() => setActiveDuplicateGroupId(null)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                          Close
                        </button>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Survivor lead</span>
                          <select value={mergePrimaryLeadId} onChange={(event) => setMergePrimaryLeadId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                            {activeDuplicateGroup.leads.map((lead) => (
                              <option key={lead.leadId} value={lead.leadId}>
                                {toTitleCase(lead.name)} | #{lead.leadId.slice(-6)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Duplicate lead</span>
                          <select value={mergeDuplicateLeadId} onChange={(event) => setMergeDuplicateLeadId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                            {activeDuplicateGroup.leads.filter((lead) => lead.leadId !== mergePrimaryLeadId).map((lead) => (
                              <option key={lead.leadId} value={lead.leadId}>
                                {toTitleCase(lead.name)} | #{lead.leadId.slice(-6)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block md:col-span-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Survivor rule</span>
                          <select value={mergeStrategy} onChange={(event) => setMergeStrategy(event.target.value as LeadMergeStrategy)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                            <option value="recent_non_empty">Prefer the most recently updated non-empty value</option>
                            <option value="primary_first">Keep the selected survivor value unless it is blank</option>
                          </select>
                        </label>
                      </div>

                      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                        <div className="grid grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <div>Field</div>
                          <div>Survivor</div>
                          <div>Duplicate</div>
                          <div>Resolved</div>
                        </div>
                        <div className="divide-y divide-slate-200">
                          {mergePreview.map((field) => (
                            <div key={field.key} className="grid grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] px-4 py-3 text-sm">
                              <div className="font-medium text-slate-900">{field.label}</div>
                              <div className="pr-3 text-slate-600">{field.primaryValue}</div>
                              <div className={`pr-3 ${field.conflict ? "text-amber-700" : "text-slate-600"}`}>{field.duplicateValue}</div>
                              <div className="font-medium text-slate-900">{field.resolvedValue}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {mergeError ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{mergeError}</div> : null}

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={handleMergeDuplicateGroup} disabled={mergingDuplicate || !mergePrimaryLead || !mergeDuplicateLead} className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60">
                          {mergingDuplicate ? "Merging..." : "Merge duplicate"}
                        </button>
                        <button type="button" onClick={() => openLeadDetail({ lead: mergePrimaryLead, section: crmLayout.defaultSection })} className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                          Open survivor
                        </button>
                        <button type="button" onClick={() => openLeadDetail({ lead: mergeDuplicateLead, section: crmLayout.defaultSection })} className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                          Review duplicate
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
                      Pick a duplicate group to review the merge preview.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}

      <LeadCreateModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={() => setIsCreateOpen(false)}
      />
      <LeadImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={() => setIsImportOpen(false)}
      />
      <LeadDetailPanel
        isOpen={detailLead !== null}
        onClose={closeLeadDetail}
        lead={detailLead}
        currentUser={currentUser}
        initialSection={detailSection}
        prefillOutcomeId={detailPrefillOutcomeId}
        prefillAssignmentReason={detailPrefillAssignmentReason}
        prefillAssigneeUid={detailPrefillAssigneeUid}
      />
    </div>
  );
}
