"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { applyPipFailureDecision, reviewCounsellingEntry } from "@/app/actions/hr";
import { useTeamPerformance } from "@/hooks/useTeamPerformance";
import { db } from "@/lib/firebase/client";
import { canManageTeam, canViewSalesHierarchyReports, formatRoleLabel } from "@/lib/access";
import { isLeadStale24h } from "@/lib/crm/workbench";
import { getLeadStatusLabel, isClosedLeadStatus } from "@/lib/leads/status";
import {
  getEffectiveReportsToUid,
  getSalesHierarchyRank,
  normalizeSalesHierarchyRole,
  SALES_HIERARCHY_ORDER,
  type SalesHierarchyRole,
} from "@/lib/sales/hierarchy";
import {
  buildBdaBiWeeklyScorecard,
  summarizeBiWeeklyScorecards,
  type BiWeeklyStatus,
} from "@/lib/sales/biweekly-targets";
import {
  aggregateCounsellingByCycle,
  buildCounsellingEntryCycleMeta,
  buildCounsellingFinanceExportCsv,
  COUNSELLING_INCENTIVE_PER_ENTRY,
  COUNSELLING_TARGET_PER_CYCLE,
} from "@/lib/sales/counselling";
import {
  COUNSELLING_PAYOUT_MIN_ROLLING_SALES,
  isCounsellingPayoutEligible,
} from "@/lib/sales/incentives";
import {
  buildPipCaseFromMissedScorecard,
  evaluatePipCase,
  getPipCaseId,
} from "@/lib/sales/pip";
import { toTitleCase } from "@/lib/utils/stringUtils";
import type { UserDoc } from "@/lib/types/user";
import type { LeadDoc } from "@/lib/types/crm";
import type {
  BdaCounsellingEntryDoc,
  BdaPipCaseDoc,
  PipFailureAction,
} from "@/lib/types/performance";
import { canUserOperate } from "@/lib/people/lifecycle";

type ReportStatus = "submitted" | "pending" | "on_leave";
type ScopeMode = "hierarchy" | "direct_reports" | "self";
type StatusFilter = "all" | ReportStatus;
type RoleFilter = "all" | SalesHierarchyRole;
type BiWeeklyStatusFilter = "all" | BiWeeklyStatus;
type CounsellingStatusFilter = "all" | "pending" | "approved" | "rejected";

type ReportDoc = {
  id: string;
  userId: string;
  date: string;
  status: ReportStatus;
  createdAt: unknown;
};

type UserNode = UserDoc & {
  children: UserNode[];
  latestReport?: ReportDoc;
};

type ReportTemplateDoc = {
  id: string;
  ownerUid: string;
  name: string;
  scopeMode: ScopeMode;
  statusFilter: StatusFilter;
  roleFilter?: RoleFilter;
  reportDate: string;
};

type ReportScheduleDoc = {
  id: string;
  ownerUid: string;
  name: string;
  templateId: string | null;
  frequency: "daily" | "weekly";
  destination: string;
  active: boolean;
};

type HierarchyPack = {
  role: SalesHierarchyRole;
  label: string;
  total: number;
  submitted: number;
  pending: number;
  onLeave: number;
};

type BdaUniversitySales = {
  university: string;
  salesAmount: number;
  loanAmount: number;
  salesCount: number;
};

type BdaSalesTrackerRow = {
  uid: string;
  name: string;
  managerName: string;
  salesCount: number;
  salesAmount: number;
  loanAmount: number;
  nonLoanAmount: number;
  universities: BdaUniversitySales[];
};

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && "seconds" in value && typeof (value as { seconds?: unknown }).seconds === "number") {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMillis(value: unknown) {
  return toDate(value)?.getTime() ?? 0;
}

function toDateKey(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function triggerCsvDownload(fileName: string, csv: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName;
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function statusOf(node: UserNode): ReportStatus {
  return node.latestReport?.status ?? "pending";
}

function chunk<T>(values: T[], size: number) {
  const buckets: T[][] = [];
  for (let i = 0; i < values.length; i += size) buckets.push(values.slice(i, i + size));
  return buckets;
}

function getNodeRole(node: Pick<UserDoc, "orgRole" | "role">) {
  return normalizeSalesHierarchyRole(node.orgRole ?? node.role ?? null);
}

function normalizeRoleToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

function getLeadOwnerUid(lead: LeadDoc) {
  return lead.ownerUid ?? lead.assignedTo ?? null;
}

function isActiveUserRecord(user: UserDoc) {
  return canUserOperate(user);
}

function isBdaUser(user: Pick<UserDoc, "orgRole" | "role"> | null | undefined) {
  return normalizeSalesHierarchyRole(user?.orgRole ?? user?.role ?? null) === "BDA";
}

function isSalesHierarchyUser(user: Pick<UserDoc, "orgRole" | "role"> | null | undefined) {
  return Boolean(normalizeSalesHierarchyRole(user?.orgRole ?? user?.role ?? null));
}

function toAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getLeadSalesAmount(lead: LeadDoc) {
  const amount = toAmount(lead.enrollmentDetails?.fee ?? lead.courseFees ?? 0);
  return Math.max(0, amount);
}

function parseLargestCurrencyAmount(value: string) {
  if (!value.trim()) return 0;
  const matches = value.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  let best = 0;
  matches.forEach((entry) => {
    const parsed = Number(entry.replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed > best) best = parsed;
  });
  return best;
}

function inferLoanAmount(lead: LeadDoc, salesAmount: number) {
  if (salesAmount <= 0) return 0;

  const paymentMode = String(lead.enrollmentDetails?.paymentMode ?? "").toLowerCase();
  const detailText = [
    String(lead.enrollmentDetails?.emiDetails ?? ""),
    String(lead.enrollmentDetails?.utrNumber ?? ""),
    String(lead.subStatus ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  const loanFlag =
    paymentMode.includes("loan") ||
    paymentMode.includes("emi") ||
    detailText.includes("loan") ||
    detailText.includes("emi");

  if (!loanFlag) return 0;

  const parsed = parseLargestCurrencyAmount(detailText);
  if (parsed > 0) {
    return Math.min(parsed, salesAmount);
  }
  return salesAmount;
}

function getLeadClosedDate(lead: LeadDoc) {
  return toDate(lead.enrollmentDetails?.closedAt ?? lead.closedAt ?? lead.updatedAt ?? lead.createdAt);
}

function getBiWeeklyStatusLabel(status: BiWeeklyStatus) {
  if (status === "on_track") return "On Track";
  if (status === "at_risk") return "At Risk";
  return "Missed";
}

function isOverdueFollowUp(lead: LeadDoc, dateKey: string) {
  if (isClosedLeadStatus(lead.status)) return false;
  if (!lead.nextFollowUpDateKey) return false;
  return lead.nextFollowUpDateKey < dateKey;
}

function isTransferBacklog(lead: LeadDoc, now: Date) {
  if (!lead.custodyState) return false;
  if (!["pulled_back", "pooled", "reassigned"].includes(lead.custodyState)) return false;
  const updatedAt = toDate(lead.custodyUpdatedAt) ?? toDate(lead.updatedAt);
  if (!updatedAt) return true;
  return now.getTime() - updatedAt.getTime() >= 24 * 60 * 60 * 1000;
}

function buildScopeTree(users: UserDoc[], reports: ReportDoc[], currentUser: UserDoc | null): UserNode[] {
  const map = new Map<string, UserNode>();
  const visible = users.filter((u) => (u.orgRole || "").toUpperCase() !== "SUPER_ADMIN");
  visible.forEach((u) => {
    map.set(u.uid, { ...u, children: [], latestReport: reports.find((r) => r.userId === u.uid) });
  });

  const roots: UserNode[] = [];
  map.forEach((node) => {
    const parentUid = getEffectiveReportsToUid(node);
    if (parentUid && map.has(parentUid)) map.get(parentUid)!.children.push(node);
    else roots.push(node);
  });

  if (!currentUser) return [];
  const normalizedRole = String(currentUser.orgRole ?? currentUser.role ?? "").toUpperCase();
  const isSuper = normalizedRole === "SUPER_ADMIN";
  const isAdmin = normalizedRole === "ADMIN";
  const isHr = normalizedRole === "HR";
  const isManagerOrAbove =
    getSalesHierarchyRank({
      role: currentUser.role ?? null,
      orgRole: currentUser.orgRole ?? null,
    }) >= getSalesHierarchyRank("MANAGER");
  if (isSuper || isAdmin || isHr || isManagerOrAbove) return roots;
  if (map.has(currentUser.uid)) return [map.get(currentUser.uid)!];
  return [];
}

function flatten(nodes: UserNode[]): UserNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function useHierarchicalReports(currentUser: UserDoc | null) {
  const [reportDate, setReportDate] = useState(todayKey());
  const { reportData, users, loading } = useTeamPerformance(currentUser, reportDate);
  const tree = useMemo(() => {
    if (!currentUser || users.length === 0) return [];
    return buildScopeTree(users, reportData as unknown as ReportDoc[], currentUser);
  }, [currentUser, reportData, users]);
  return { tree, users, loading, reportDate, setReportDate };
}

export default function ReportsPage() {
  const { userDoc, firebaseUser } = useAuth();
  const { tree, users, loading, reportDate, setReportDate } = useHierarchicalReports(userDoc);
  const flatTree = useMemo(() => flatten(tree), [tree]);
  const isHrActor = useMemo(
    () => String(userDoc?.orgRole ?? userDoc?.role ?? "").toUpperCase() === "HR",
    [userDoc?.orgRole, userDoc?.role],
  );
  const canUseHierarchyScope = canManageTeam(userDoc) || isHrActor;

  const [scopeMode, setScopeMode] = useState<ScopeMode>("hierarchy");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [activeKpi, setActiveKpi] = useState<"all" | ReportStatus>("all");

  const [templateName, setTemplateName] = useState("");
  const [templateRows, setTemplateRows] = useState<ReportTemplateDoc[]>([]);
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);

  const [scheduleName, setScheduleName] = useState("");
  const [scheduleFrequency, setScheduleFrequency] = useState<"daily" | "weekly">("daily");
  const [scheduleDestination, setScheduleDestination] = useState("");
  const [scheduleTemplateId, setScheduleTemplateId] = useState("");
  const [scheduleRows, setScheduleRows] = useState<ReportScheduleDoc[]>([]);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);

  const [leadSearch, setLeadSearch] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState<string>("all");
  const [leadOwnerFilter, setLeadOwnerFilter] = useState<string>("all");
  const [leadListLimit, setLeadListLimit] = useState<number>(150);
  const [salesSearch, setSalesSearch] = useState("");
  const [salesManagerFilter, setSalesManagerFilter] = useState("all");
  const [salesSortMode, setSalesSortMode] = useState<
    "sales_amount_desc" | "loan_amount_desc" | "sales_count_desc"
  >("sales_amount_desc");
  const [biWeeklySearch, setBiWeeklySearch] = useState("");
  const [biWeeklyStatusFilter, setBiWeeklyStatusFilter] = useState<BiWeeklyStatusFilter>("all");
  const [biWeeklyManagerFilter, setBiWeeklyManagerFilter] = useState("all");
  const [scopeLeads, setScopeLeads] = useState<LeadDoc[]>([]);
  const [scopeLeadsLoading, setScopeLeadsLoading] = useState(false);
  const [hrSalesUsers, setHrSalesUsers] = useState<UserDoc[]>([]);
  const [salesExpandedUid, setSalesExpandedUid] = useState<string | null>(null);
  const [pipCases, setPipCases] = useState<BdaPipCaseDoc[]>([]);
  const [pipCaseError, setPipCaseError] = useState<string | null>(null);
  const [pipDecisionLoadingId, setPipDecisionLoadingId] = useState<string | null>(null);
  const [counsellingEntries, setCounsellingEntries] = useState<BdaCounsellingEntryDoc[]>([]);
  const [counsellingError, setCounsellingError] = useState<string | null>(null);
  const [counsellingReviewLoadingId, setCounsellingReviewLoadingId] = useState<string | null>(null);
  const [counsellingStatusFilter, setCounsellingStatusFilter] = useState<CounsellingStatusFilter>("all");

  const isExecutiveActor = useMemo(() => {
    const role = normalizeRoleToken(userDoc?.role);
    const orgRole = normalizeRoleToken(userDoc?.orgRole);
    return role === "SUPER_ADMIN" || role === "ADMIN" || orgRole === "SUPER_ADMIN" || orgRole === "ADMIN";
  }, [userDoc?.orgRole, userDoc?.role]);
  const isManagerOrAboveActor = useMemo(
    () =>
      getSalesHierarchyRank({
        role: userDoc?.role ?? null,
        orgRole: userDoc?.orgRole ?? null,
      }) >= getSalesHierarchyRank("MANAGER"),
    [userDoc?.orgRole, userDoc?.role],
  );
  const canManagePerformanceActions = useMemo(
    () => isExecutiveActor || isHrActor || isManagerOrAboveActor,
    [isExecutiveActor, isHrActor, isManagerOrAboveActor],
  );

  useEffect(() => {
    if (!userDoc) return;
    setScopeMode(canUseHierarchyScope ? "hierarchy" : "self");
  }, [canUseHierarchyScope, userDoc]);

  useEffect(() => {
    async function loadHrSalesUsers() {
      const firestore = db;
      if (!firestore || !userDoc || !isHrActor) {
        setHrSalesUsers([]);
        return;
      }

      try {
        const snapshot = await getDocs(query(collection(firestore, "users"), limit(1500)));
        const rows = snapshot.docs
          .map((row) => ({ ...(row.data() as UserDoc), uid: row.id }))
          .filter((row) => isActiveUserRecord(row) && isSalesHierarchyUser(row));
        setHrSalesUsers(rows);
      } catch (error) {
        console.error("Failed to load HR sales users", error);
        setHrSalesUsers([]);
      }
    }
    void loadHrSalesUsers();
  }, [isHrActor, userDoc]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !userDoc?.uid) {
      setTemplateRows([]);
      return;
    }
    const q = query(collection(firestore, "report_templates"), where("ownerUid", "==", userDoc.uid), orderBy("updatedAt", "desc"), limit(25));
    return onSnapshot(
      q,
      (snap) => {
        setTemplateRows(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ReportTemplateDoc, "id">),
            roleFilter: (d.data() as { roleFilter?: RoleFilter }).roleFilter ?? "all",
          })),
        );
      },
      (error) => console.error("Template listener failed", error),
    );
  }, [userDoc?.uid]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !userDoc?.uid) {
      setScheduleRows([]);
      return;
    }
    const q = query(collection(firestore, "report_schedules"), where("ownerUid", "==", userDoc.uid), orderBy("updatedAt", "desc"), limit(25));
    return onSnapshot(
      q,
      (snap) => {
        setScheduleRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReportScheduleDoc, "id">) })));
      },
      (error) => console.error("Schedule listener failed", error),
    );
  }, [userDoc?.uid]);

  const directReportIds = useMemo(
    () => new Set(users.filter((u) => userDoc && getEffectiveReportsToUid(u) === userDoc.uid).map((u) => u.uid)),
    [userDoc, users],
  );

  const baseScopedNodes = useMemo(() => {
    if (!userDoc) return [] as UserNode[];
    let rows = [...flatTree];
    if (scopeMode === "self") rows = rows.filter((n) => n.uid === userDoc.uid);
    else if (scopeMode === "direct_reports") rows = rows.filter((n) => directReportIds.has(n.uid));
    if (statusFilter !== "all") rows = rows.filter((n) => statusOf(n) === statusFilter);
    return rows;
  }, [directReportIds, flatTree, scopeMode, statusFilter, userDoc]);

  const scopedNodes = useMemo(() => {
    if (roleFilter === "all") return baseScopedNodes;
    return baseScopedNodes.filter((node) => getNodeRole(node) === roleFilter);
  }, [baseScopedNodes, roleFilter]);

  const summary = useMemo(() => {
    const total = scopedNodes.length;
    const submitted = scopedNodes.filter((n) => statusOf(n) === "submitted").length;
    const onLeave = scopedNodes.filter((n) => statusOf(n) === "on_leave").length;
    const pending = Math.max(total - submitted - onLeave, 0);
    return { total, submitted, pending, onLeave };
  }, [scopedNodes]);

  const hierarchyPacks = useMemo<HierarchyPack[]>(() => {
    const packs = new Map<SalesHierarchyRole, HierarchyPack>();
    SALES_HIERARCHY_ORDER.forEach((role) => {
      packs.set(role, { role, label: formatRoleLabel(role), total: 0, submitted: 0, pending: 0, onLeave: 0 });
    });

    baseScopedNodes.forEach((node) => {
      const role = getNodeRole(node);
      if (!role) return;
      const pack = packs.get(role);
      if (!pack) return;
      pack.total += 1;
      if (statusOf(node) === "submitted") pack.submitted += 1;
      if (statusOf(node) === "pending") pack.pending += 1;
      if (statusOf(node) === "on_leave") pack.onLeave += 1;
    });

    return SALES_HIERARCHY_ORDER.map((role) => packs.get(role)!).filter((pack) => pack.total > 0);
  }, [baseScopedNodes]);

  const scopeUserIds = useMemo(() => {
    if (isHrActor && scopeMode === "hierarchy") {
      return Array.from(new Set(hrSalesUsers.map((user) => user.uid))).filter(Boolean);
    }
    return Array.from(new Set(scopedNodes.map((node) => node.uid))).filter(Boolean);
  }, [hrSalesUsers, isHrActor, scopeMode, scopedNodes]);
  const scopeUsersKey = useMemo(() => scopeUserIds.join("|"), [scopeUserIds]);

  useEffect(() => {
    async function loadScopeLeads() {
      const firestore = db;
      if (!firestore || scopeUserIds.length === 0) {
        setScopeLeads([]);
        return;
      }
      setScopeLeadsLoading(true);
      try {
        const snapshots = await Promise.all(
          chunk(scopeUserIds, 10).map((uids) =>
            getDocs(query(collection(firestore, "leads"), where("ownerUid", "in", uids), limit(300))),
          ),
        );
        const merged = new Map<string, LeadDoc>();
        snapshots.forEach((snap) => {
          snap.docs.forEach((docRow) => merged.set(docRow.id, { ...(docRow.data() as LeadDoc), leadId: docRow.id }));
        });
        setScopeLeads(Array.from(merged.values()).sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)));
      } catch (error) {
        console.error("Scoped lead load failed", error);
        setScopeLeads([]);
      } finally {
        setScopeLeadsLoading(false);
      }
    }
    void loadScopeLeads();
  }, [scopeUserIds]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || scopeUserIds.length === 0) {
      setPipCases([]);
      setPipCaseError(null);
      return;
    }

    setPipCaseError(null);
    const buckets = new Map<string, BdaPipCaseDoc[]>();
    const listeners = chunk(scopeUserIds, 10).map((uids, index) =>
      onSnapshot(
        query(collection(firestore, "bda_pip_cases"), where("bdaUid", "in", uids), limit(600)),
        (snapshot) => {
          buckets.set(
            `pip-${index}`,
            snapshot.docs.map((row) => ({ ...(row.data() as BdaPipCaseDoc), id: row.id })),
          );
          const merged = new Map<string, BdaPipCaseDoc>();
          buckets.forEach((rows) => rows.forEach((row) => merged.set(row.id, row)));
          const ranked = Array.from(merged.values()).sort((left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt));
          setPipCases(ranked);
        },
        (error) => {
          console.error("PIP case listener failed", error);
          setPipCaseError(error.message || "Unable to load PIP cases.");
        },
      ),
    );

    return () => listeners.forEach((stop) => stop());
  }, [scopeUsersKey, scopeUserIds]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || scopeUserIds.length === 0) {
      setCounsellingEntries([]);
      setCounsellingError(null);
      return;
    }

    setCounsellingError(null);
    const buckets = new Map<string, BdaCounsellingEntryDoc[]>();
    const listeners = chunk(scopeUserIds, 10).map((uids, index) =>
      onSnapshot(
        query(collection(firestore, "bda_counselling_entries"), where("bdaUid", "in", uids), limit(1500)),
        (snapshot) => {
          buckets.set(
            `counselling-${index}`,
            snapshot.docs.map((row) => ({ ...(row.data() as BdaCounsellingEntryDoc), id: row.id })),
          );
          const merged = new Map<string, BdaCounsellingEntryDoc>();
          buckets.forEach((rows) => rows.forEach((row) => merged.set(row.id, row)));
          const ranked = Array.from(merged.values()).sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
          setCounsellingEntries(ranked);
        },
        (error) => {
          console.error("Counselling listener failed", error);
          setCounsellingError(error.message || "Unable to load counselling entries.");
        },
      ),
    );

    return () => listeners.forEach((stop) => stop());
  }, [scopeUsersKey, scopeUserIds]);

  const salesTrackerUserMap = useMemo(() => {
    const map = new Map<string, UserDoc>();
    users.forEach((user) => map.set(user.uid, user));
    scopedNodes.forEach((user) => map.set(user.uid, user));
    hrSalesUsers.forEach((user) => map.set(user.uid, user));
    if (userDoc?.uid) map.set(userDoc.uid, userDoc);
    return map;
  }, [hrSalesUsers, scopedNodes, userDoc, users]);

  const salesTrackerRows = useMemo<BdaSalesTrackerRow[]>(() => {
    const rowMap = new Map<string, BdaSalesTrackerRow>();

    scopeLeads.forEach((lead) => {
      if (!isClosedLeadStatus(lead.status)) return;
      const ownerUid = getLeadOwnerUid(lead);
      if (!ownerUid) return;

      const owner = salesTrackerUserMap.get(ownerUid);
      if (!isBdaUser(owner)) return;

      const salesAmount = getLeadSalesAmount(lead);
      if (salesAmount <= 0) return;
      const loanAmount = Math.min(salesAmount, inferLoanAmount(lead, salesAmount));
      const managerUid = owner ? getEffectiveReportsToUid(owner) : null;
      const managerLabel = managerUid
        ? salesTrackerUserMap.get(managerUid)?.displayName ||
          salesTrackerUserMap.get(managerUid)?.email ||
          managerUid
        : "-";
      const ownerLabel = owner?.displayName || owner?.email || ownerUid;

      if (!rowMap.has(ownerUid)) {
        rowMap.set(ownerUid, {
          uid: ownerUid,
          name: ownerLabel,
          managerName: managerLabel,
          salesCount: 0,
          salesAmount: 0,
          loanAmount: 0,
          nonLoanAmount: 0,
          universities: [],
        });
      }

      const row = rowMap.get(ownerUid)!;
      row.salesCount += 1;
      row.salesAmount += salesAmount;
      row.loanAmount += loanAmount;
      row.nonLoanAmount += Math.max(0, salesAmount - loanAmount);

      const universityLabel =
        String(lead.enrollmentDetails?.university ?? lead.targetUniversity ?? "").trim() ||
        "Unknown University";
      const existingUni = row.universities.find((entry) => entry.university === universityLabel);
      if (existingUni) {
        existingUni.salesAmount += salesAmount;
        existingUni.loanAmount += loanAmount;
        existingUni.salesCount += 1;
      } else {
        row.universities.push({
          university: universityLabel,
          salesAmount,
          loanAmount,
          salesCount: 1,
        });
      }
    });

    return Array.from(rowMap.values())
      .map((row) => ({
        ...row,
        universities: [...row.universities].sort(
          (left, right) => right.salesAmount - left.salesAmount,
        ),
      }))
      .sort((left, right) => right.salesAmount - left.salesAmount);
  }, [salesTrackerUserMap, scopeLeads]);
  const salesManagerOptions = useMemo(
    () =>
      Array.from(new Set(salesTrackerRows.map((row) => row.managerName).filter(Boolean))).sort(
        (left, right) => left.localeCompare(right),
      ),
    [salesTrackerRows],
  );
  const filteredSalesTrackerRows = useMemo(() => {
    const normalizedSearch = salesSearch.trim().toLowerCase();
    const rows = salesTrackerRows.filter((row) => {
      const matchesManager =
        salesManagerFilter === "all" || row.managerName === salesManagerFilter;
      if (!matchesManager) return false;
      if (!normalizedSearch) return true;
      const universityPool = row.universities
        .slice(0, 5)
        .map((entry) => entry.university)
        .join(" ");
      return [row.uid, row.name, row.managerName, universityPool]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });

    const ranked = [...rows];
    if (salesSortMode === "sales_count_desc") {
      ranked.sort((left, right) => right.salesCount - left.salesCount);
    } else if (salesSortMode === "loan_amount_desc") {
      ranked.sort((left, right) => right.loanAmount - left.loanAmount);
    } else {
      ranked.sort((left, right) => right.salesAmount - left.salesAmount);
    }
    return ranked;
  }, [salesManagerFilter, salesSearch, salesSortMode, salesTrackerRows]);

  const salesTrackerSummary = useMemo(() => {
    return salesTrackerRows.reduce(
      (acc, row) => {
        acc.bdaCount += 1;
        acc.salesCount += row.salesCount;
        acc.salesAmount += row.salesAmount;
        acc.loanAmount += row.loanAmount;
        acc.nonLoanAmount += row.nonLoanAmount;
        return acc;
      },
      {
        bdaCount: 0,
        salesCount: 0,
        salesAmount: 0,
        loanAmount: 0,
        nonLoanAmount: 0,
      },
    );
  }, [salesTrackerRows]);
  const filteredSalesSummary = useMemo(() => {
    return filteredSalesTrackerRows.reduce(
      (acc, row) => {
        acc.bdaCount += 1;
        acc.salesCount += row.salesCount;
        acc.salesAmount += row.salesAmount;
        acc.loanAmount += row.loanAmount;
        acc.nonLoanAmount += row.nonLoanAmount;
        return acc;
      },
      {
        bdaCount: 0,
        salesCount: 0,
        salesAmount: 0,
        loanAmount: 0,
        nonLoanAmount: 0,
      },
    );
  }, [filteredSalesTrackerRows]);
  useEffect(() => {
    if (!salesExpandedUid) return;
    if (filteredSalesTrackerRows.some((row) => row.uid === salesExpandedUid)) return;
    setSalesExpandedUid(null);
  }, [filteredSalesTrackerRows, salesExpandedUid]);

  const bdaSaleDatesMap = useMemo(() => {
    const map = new Map<string, Date[]>();
    scopeLeads.forEach((lead) => {
      if (!isClosedLeadStatus(lead.status)) return;
      const ownerUid = getLeadOwnerUid(lead);
      if (!ownerUid) return;
      const owner = salesTrackerUserMap.get(ownerUid);
      if (!isBdaUser(owner)) return;
      const closedDate = getLeadClosedDate(lead);
      if (!closedDate) return;
      if (!map.has(ownerUid)) {
        map.set(ownerUid, []);
      }
      map.get(ownerUid)!.push(closedDate);
    });
    return map;
  }, [salesTrackerUserMap, scopeLeads]);

  const biWeeklyScorecards = useMemo(() => {
    const scopedBdaUsers = scopeUserIds
      .map((uid) => salesTrackerUserMap.get(uid))
      .filter((user): user is UserDoc => Boolean(user) && isBdaUser(user));

    const rows = new Map<
      string,
      {
        uid: string;
        name: string;
        managerName: string;
        saleDates: Date[];
      }
    >();

    scopedBdaUsers.forEach((user) => {
      const managerUid = getEffectiveReportsToUid(user);
      const managerName = managerUid
        ? salesTrackerUserMap.get(managerUid)?.displayName ||
          salesTrackerUserMap.get(managerUid)?.email ||
          managerUid
        : "-";
      rows.set(user.uid, {
        uid: user.uid,
        name: user.displayName || user.email || user.uid,
        managerName,
        saleDates: bdaSaleDatesMap.get(user.uid) ?? [],
      });
    });

    bdaSaleDatesMap.forEach((saleDates, ownerUid) => {
      if (rows.has(ownerUid)) return;
      const owner = salesTrackerUserMap.get(ownerUid);
      if (!isBdaUser(owner)) return;
      const managerUid = owner ? getEffectiveReportsToUid(owner) : null;
      const managerName = managerUid
        ? salesTrackerUserMap.get(managerUid)?.displayName ||
          salesTrackerUserMap.get(managerUid)?.email ||
          managerUid
        : "-";
      rows.set(ownerUid, {
        uid: ownerUid,
        name: owner?.displayName || owner?.email || ownerUid,
        managerName,
        saleDates: saleDates.slice(),
      });
    });

    const severity: Record<BiWeeklyStatus, number> = {
      missed: 0,
      at_risk: 1,
      on_track: 2,
    };

    return Array.from(rows.values())
      .map((row) =>
        buildBdaBiWeeklyScorecard({
          uid: row.uid,
          name: row.name,
          managerName: row.managerName,
          saleDates: row.saleDates,
          referenceDate: new Date(),
        }),
      )
      .sort((left, right) => {
        const severityDiff = severity[left.status] - severity[right.status];
        if (severityDiff !== 0) return severityDiff;
        if (right.rollingSales !== left.rollingSales) return right.rollingSales - left.rollingSales;
        return left.name.localeCompare(right.name);
      });
  }, [bdaSaleDatesMap, salesTrackerUserMap, scopeUserIds]);

  const biWeeklySummary = useMemo(() => summarizeBiWeeklyScorecards(biWeeklyScorecards), [biWeeklyScorecards]);

  const biWeeklyManagerOptions = useMemo(
    () =>
      Array.from(new Set(biWeeklyScorecards.map((row) => row.managerName).filter(Boolean))).sort(
        (left, right) => left.localeCompare(right),
      ),
    [biWeeklyScorecards],
  );

  const filteredBiWeeklyScorecards = useMemo(() => {
    const searchTerm = biWeeklySearch.trim().toLowerCase();
    return biWeeklyScorecards.filter((row) => {
      if (biWeeklyStatusFilter !== "all" && row.status !== biWeeklyStatusFilter) return false;
      if (biWeeklyManagerFilter !== "all" && row.managerName !== biWeeklyManagerFilter) return false;
      if (!searchTerm) return true;
      return [row.uid, row.name, row.managerName, row.currentCycle.label]
        .join(" ")
        .toLowerCase()
        .includes(searchTerm);
    });
  }, [biWeeklyManagerFilter, biWeeklyScorecards, biWeeklySearch, biWeeklyStatusFilter]);

  useEffect(() => {
    if (biWeeklyManagerFilter === "all") return;
    if (biWeeklyManagerOptions.includes(biWeeklyManagerFilter)) return;
    setBiWeeklyManagerFilter("all");
  }, [biWeeklyManagerFilter, biWeeklyManagerOptions]);

  const currentCounsellingCycle = useMemo(
    () => buildCounsellingEntryCycleMeta({ date: new Date() }),
    [],
  );

  const counsellingEligibilityByBda = useMemo(() => {
    const map = new Map<string, boolean>();
    biWeeklyScorecards.forEach((row) => {
      map.set(row.uid, isCounsellingPayoutEligible(row.rollingSales));
    });
    return map;
  }, [biWeeklyScorecards]);

  const counsellingCycleSummaryRows = useMemo(
    () =>
      aggregateCounsellingByCycle({
        entries: counsellingEntries,
        cycleIndex: currentCounsellingCycle.cycleIndex,
        payoutEligibilityByBda: counsellingEligibilityByBda,
      }),
    [counsellingEligibilityByBda, counsellingEntries, currentCounsellingCycle.cycleIndex],
  );

  const filteredCounsellingEntries = useMemo(() => {
    if (counsellingStatusFilter === "all") return counsellingEntries;
    return counsellingEntries.filter((entry) => entry.status === counsellingStatusFilter);
  }, [counsellingEntries, counsellingStatusFilter]);

  const pipCasesById = useMemo(() => {
    const map = new Map<string, BdaPipCaseDoc>();
    pipCases.forEach((row) => map.set(row.id, row));
    return map;
  }, [pipCases]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !userDoc || !canManagePerformanceActions) return;

    const now = new Date();
    const actor = {
      uid: userDoc.uid,
      name: userDoc.displayName ?? userDoc.email ?? userDoc.uid,
      role: String(userDoc.orgRole ?? userDoc.role ?? ""),
      employeeId: userDoc.employeeId ?? null,
    };

    const writes: Promise<unknown>[] = [];

    biWeeklyScorecards
      .filter((row) => row.status === "missed")
      .forEach((row) => {
        const pipId = getPipCaseId(row.uid, row.currentCycle.index);
        if (pipCasesById.has(pipId)) return;

        const owner = salesTrackerUserMap.get(row.uid);
        const managerUid = owner ? getEffectiveReportsToUid(owner) : null;
        const managerName = managerUid
          ? salesTrackerUserMap.get(managerUid)?.displayName ||
            salesTrackerUserMap.get(managerUid)?.email ||
            managerUid
          : row.managerName;

        const seed = buildPipCaseFromMissedScorecard({ scorecard: row, now });
        writes.push(
          setDoc(doc(firestore, "bda_pip_cases", pipId), {
            ...seed,
            managerUid,
            managerName,
            createdBy: actor,
            updatedBy: actor,
            updatedAt: now,
          }),
        );
      });

    pipCases
      .filter((row) => row.status === "active")
      .forEach((row) => {
        const sales = bdaSaleDatesMap.get(row.bdaUid) ?? [];
        const next = evaluatePipCase({
          pipCase: row,
          saleDates: sales,
          now,
          actor,
        });
        if (!next) return;
        writes.push(
          setDoc(
            doc(firestore, "bda_pip_cases", row.id),
            {
              ...next,
              updatedBy: actor,
            },
            { merge: true },
          ),
        );
      });

    if (writes.length === 0) return;
    void Promise.all(writes).catch((error) => {
      console.error("Failed to sync PIP cases", error);
      setPipCaseError("Unable to sync PIP cases automatically.");
    });
  }, [
    bdaSaleDatesMap,
    biWeeklyScorecards,
    canManagePerformanceActions,
    pipCases,
    pipCasesById,
    salesTrackerUserMap,
    userDoc,
  ]);

  const pipSummary = useMemo(
    () =>
      pipCases.reduce(
        (summary, row) => {
          summary.total += 1;
          if (row.status === "active") summary.active += 1;
          if (row.status === "passed") summary.passed += 1;
          if (row.status === "failed") summary.failed += 1;
          return summary;
        },
        { total: 0, active: 0, passed: 0, failed: 0 },
      ),
    [pipCases],
  );

  async function handlePipFailureDecision(
    row: BdaPipCaseDoc,
    decision: PipFailureAction,
  ) {
    if (!firebaseUser) return;
    const reason = window.prompt("Provide reason for this PIP action.");
    if (!reason || !reason.trim()) return;

    let inactiveUntil: string | null = null;
    if (decision === "set_inactive_window") {
      const dateValue = window.prompt("Set inactive till date (YYYY-MM-DD).");
      if (!dateValue || !dateValue.trim()) return;
      inactiveUntil = dateValue.trim();
    }

    setPipDecisionLoadingId(row.id);
    try {
      const token = await firebaseUser.getIdToken();
      const result = await applyPipFailureDecision({
        pipCaseId: row.id,
        targetUid: row.bdaUid,
        decision,
        reason,
        callerIdToken: token,
        extensionDays: decision === "extend_inactive" ? 14 : null,
        inactiveUntil,
      });
      if (!result.success) {
        throw new Error(result.error || "Unable to apply PIP action.");
      }
    } catch (error) {
      console.error("PIP failure decision error", error);
      const message = error instanceof Error ? error.message : "Unable to apply PIP action.";
      window.alert(message);
    } finally {
      setPipDecisionLoadingId(null);
    }
  }

  async function handleCounsellingReview(
    entryId: string,
    status: "approved" | "rejected",
  ) {
    if (!firebaseUser) return;
    const reason = status === "rejected"
      ? window.prompt("Provide reason for rejection.")
      : window.prompt("Optional review note (leave blank to skip).");
    if (status === "rejected" && (!reason || !reason.trim())) {
      return;
    }

    setCounsellingReviewLoadingId(entryId);
    try {
      const token = await firebaseUser.getIdToken();
      const result = await reviewCounsellingEntry({
        callerIdToken: token,
        entryId,
        status,
        reason: reason?.trim() || null,
      });
      if (!result.success) {
        throw new Error(result.error || "Unable to review counselling entry.");
      }
    } catch (error) {
      console.error("Counselling review error", error);
      const message =
        error instanceof Error ? error.message : "Unable to review counselling entry.";
      window.alert(message);
    } finally {
      setCounsellingReviewLoadingId(null);
    }
  }

  function downloadCounsellingFinancePayload() {
    const csv = buildCounsellingFinanceExportCsv({
      rows: counsellingCycleSummaryRows,
      cycleLabel: currentCounsellingCycle.cycleLabel,
      generatedAt: new Date(),
    });
    triggerCsvDownload(
      `counselling_payout_cycle_${currentCounsellingCycle.cycleIndex}_${toDateKey(new Date())}.csv`,
      csv,
    );
  }

  const drilldownUserIds = useMemo(() => {
    const rows = activeKpi === "all" ? scopedNodes : scopedNodes.filter((n) => statusOf(n) === activeKpi);
    return rows.map((n) => n.uid);
  }, [activeKpi, scopedNodes]);

  const drilldownLeads = useMemo(() => {
    const ownerSet = new Set(drilldownUserIds);
    return scopeLeads.filter((lead) => {
      const ownerUid = getLeadOwnerUid(lead);
      return ownerUid ? ownerSet.has(ownerUid) : false;
    });
  }, [drilldownUserIds, scopeLeads]);
  const drilldownOwnerOptions = useMemo(() => {
    const labels = new Map<string, string>();
    drilldownLeads.forEach((lead) => {
      const ownerUid = getLeadOwnerUid(lead);
      if (!ownerUid || labels.has(ownerUid)) return;
      const owner = salesTrackerUserMap.get(ownerUid);
      labels.set(ownerUid, owner?.displayName || owner?.email || ownerUid);
    });
    return Array.from(labels.entries())
      .map(([uid, label]) => ({ uid, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [drilldownLeads, salesTrackerUserMap]);

  const filteredLeads = useMemo(() => {
    let rows = [...drilldownLeads];
    if (leadStatusFilter !== "all") {
      rows = rows.filter(
        (lead) =>
          String(lead.status ?? "").toLowerCase() === leadStatusFilter.toLowerCase(),
      );
    }
    if (leadOwnerFilter !== "all") {
      rows = rows.filter((lead) => getLeadOwnerUid(lead) === leadOwnerFilter);
    }

    const term = leadSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((lead) =>
      [lead.leadId, lead.name, lead.phone, lead.email, lead.targetDegree, lead.targetUniversity]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [drilldownLeads, leadOwnerFilter, leadSearch, leadStatusFilter]);
  const visibleDrilldownLeads = useMemo(
    () => filteredLeads.slice(0, leadListLimit),
    [filteredLeads, leadListLimit],
  );

  const exceptionAlerts = useMemo(() => {
    const now = new Date();
    const staleLeads = scopeLeads.filter((lead) => isLeadStale24h(lead, now));
    const overdueLeads = scopeLeads.filter((lead) => isOverdueFollowUp(lead, todayKey()));
    const transferBacklogLeads = scopeLeads.filter((lead) => isTransferBacklog(lead, now));

    return [
      {
        id: "stale",
        title: "Stale Load",
        description: "No activity for 24h+.",
        count: staleLeads.length,
        leads: staleLeads.slice(0, 6),
        tone: staleLeads.length > 20 ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50",
      },
      {
        id: "overdue",
        title: "Overdue Follow-Up",
        description: "Missed follow-up SLA.",
        count: overdueLeads.length,
        leads: overdueLeads.slice(0, 6),
        tone: overdueLeads.length > 12 ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50",
      },
      {
        id: "transfer_backlog",
        title: "Transfer Backlog",
        description: "Custody not resolved for 24h+.",
        count: transferBacklogLeads.length,
        leads: transferBacklogLeads.slice(0, 6),
        tone: transferBacklogLeads.length > 10 ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50",
      },
    ];
  }, [scopeLeads]);

  async function saveTemplate() {
    const firestore = db;
    if (!firestore || !userDoc || !templateName.trim()) return;
    await setDoc(doc(collection(firestore, "report_templates")), {
      ownerUid: userDoc.uid,
      name: templateName.trim(),
      scopeMode,
      statusFilter,
      roleFilter,
      reportDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setTemplateName("");
    setTemplateMessage("Template saved.");
  }

  async function removeTemplate(id: string) {
    const firestore = db;
    if (!firestore) return;
    await deleteDoc(doc(firestore, "report_templates", id));
  }

  async function saveSchedule() {
    const firestore = db;
    if (!firestore || !userDoc || !scheduleName.trim() || !scheduleDestination.trim()) return;
    await setDoc(doc(collection(firestore, "report_schedules")), {
      ownerUid: userDoc.uid,
      name: scheduleName.trim(),
      templateId: scheduleTemplateId || null,
      frequency: scheduleFrequency,
      destination: scheduleDestination.trim(),
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setScheduleName("");
    setScheduleDestination("");
    setScheduleTemplateId("");
    setScheduleMessage("Schedule saved.");
  }

  async function toggleSchedule(row: ReportScheduleDoc) {
    const firestore = db;
    if (!firestore) return;
    await setDoc(doc(firestore, "report_schedules", row.id), { active: !row.active, updatedAt: serverTimestamp() }, { merge: true });
  }

  async function removeSchedule(id: string) {
    const firestore = db;
    if (!firestore) return;
    await deleteDoc(doc(firestore, "report_schedules", id));
  }

  return (
    <AuthGate allowIf={canViewSalesHierarchyReports}>
      <div className="min-h-screen bg-slate-50/50">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Status Reports</h1>
              <p className="text-sm text-slate-500">Hierarchy KPI packs, exception alerts, scoped drilldowns, templates, and schedules.</p>
            </div>
            <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
          </div>

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-5">
            <select value={scopeMode} onChange={(e) => setScopeMode(e.target.value as ScopeMode)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              {canUseHierarchyScope ? <option value="hierarchy">Hierarchy</option> : null}
              {canManageTeam(userDoc) ? <option value="direct_reports">Direct reports</option> : null}
              <option value="self">Self</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option value="all">All statuses</option>
              <option value="submitted">Submitted</option>
              <option value="pending">Pending</option>
              <option value="on_leave">On leave</option>
            </select>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option value="all">All hierarchy levels</option>
              {SALES_HIERARCHY_ORDER.map((role) => <option key={role} value={role}>{formatRoleLabel(role)}</option>)}
            </select>
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <button type="button" onClick={() => void saveTemplate()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Save template</button>
            {templateMessage ? <div className="text-xs text-slate-600 md:col-span-5">{templateMessage}</div> : null}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">Templates</div>
              {templateRows.length === 0 ? <div className="text-xs text-slate-500">No templates.</div> : templateRows.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <button type="button" onClick={() => { setScopeMode(t.scopeMode); setStatusFilter(t.statusFilter); setRoleFilter(t.roleFilter ?? "all"); setReportDate(t.reportDate); }} className="text-left">
                    <div className="text-sm font-semibold text-slate-900">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.scopeMode} | {t.statusFilter} | {formatRoleLabel(t.roleFilter ?? "all")} | {t.reportDate}</div>
                  </button>
                  <button type="button" onClick={() => void removeTemplate(t.id)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">Delete</button>
                </div>
              ))}
            </div>

            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">Scheduled exports</div>
              <div className="grid gap-2 md:grid-cols-2">
                <input value={scheduleName} onChange={(e) => setScheduleName(e.target.value)} placeholder="Schedule name" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <select value={scheduleFrequency} onChange={(e) => setScheduleFrequency(e.target.value as "daily" | "weekly")} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
                <input value={scheduleDestination} onChange={(e) => setScheduleDestination(e.target.value)} placeholder="Email destination" className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2" />
                <select value={scheduleTemplateId} onChange={(e) => setScheduleTemplateId(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2"><option value="">Use current filters</option>{templateRows.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                <button type="button" onClick={() => void saveSchedule()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white md:col-span-2">Save schedule</button>
              </div>
              {scheduleMessage ? <div className="text-xs text-slate-600">{scheduleMessage}</div> : null}
              <div className="space-y-2">{scheduleRows.map((s) => <div key={s.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-xs"><div className="font-semibold text-slate-900">{s.name}</div><div className="text-slate-500">{s.frequency} | {s.destination} | {s.active ? "Active" : "Paused"}</div></div><div className="flex gap-2"><button type="button" onClick={() => void toggleSchedule(s)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">{s.active ? "Pause" : "Resume"}</button><button type="button" onClick={() => void removeSchedule(s.id)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">Delete</button></div></div>)}</div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <button type="button" onClick={() => setActiveKpi("all")} className={`rounded-2xl border px-4 py-3 text-left ${activeKpi === "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}><div className="text-xs uppercase">In scope</div><div className="mt-1 text-2xl font-semibold">{summary.total}</div></button>
            <button type="button" onClick={() => setActiveKpi("submitted")} className={`rounded-2xl border px-4 py-3 text-left ${activeKpi === "submitted" ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}><div className="text-xs uppercase">Submitted</div><div className="mt-1 text-2xl font-semibold">{summary.submitted}</div></button>
            <button type="button" onClick={() => setActiveKpi("pending")} className={`rounded-2xl border px-4 py-3 text-left ${activeKpi === "pending" ? "border-amber-600 bg-amber-600 text-white" : "border-amber-200 bg-amber-50 text-amber-900"}`}><div className="text-xs uppercase">Pending</div><div className="mt-1 text-2xl font-semibold">{summary.pending}</div></button>
            <button type="button" onClick={() => setActiveKpi("on_leave")} className={`rounded-2xl border px-4 py-3 text-left ${activeKpi === "on_leave" ? "border-slate-700 bg-slate-700 text-white" : "border-slate-200 bg-slate-100 text-slate-900"}`}><div className="text-xs uppercase">On leave</div><div className="mt-1 text-2xl font-semibold">{summary.onLeave}</div></button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Sales Tracker by BDA</div>
                <div className="text-xs text-slate-500">
                  HR and hierarchy managers can track BDA sales, loan bifurcation, and university-wise closures.
                </div>
              </div>
              <div className="text-xs text-slate-600">
                In scope BDAs: <span className="font-semibold text-slate-900">{salesTrackerSummary.bdaCount}</span> | Filtered BDAs:{" "}
                <span className="font-semibold text-slate-900">{filteredSalesSummary.bdaCount}</span>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] uppercase text-slate-500">Sales Amount</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  ₹{Intl.NumberFormat("en-IN").format(Math.round(salesTrackerSummary.salesAmount))}
                </div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-[11px] uppercase text-amber-700">Loan Amount</div>
                <div className="mt-1 text-lg font-semibold text-amber-900">
                  ₹{Intl.NumberFormat("en-IN").format(Math.round(salesTrackerSummary.loanAmount))}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] uppercase text-emerald-700">Non-Loan Amount</div>
                <div className="mt-1 text-lg font-semibold text-emerald-900">
                  ₹{Intl.NumberFormat("en-IN").format(Math.round(salesTrackerSummary.nonLoanAmount))}
                </div>
              </div>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                <div className="text-[11px] uppercase text-indigo-700">Coverage</div>
                <div className="mt-1 text-lg font-semibold text-indigo-900">
                  {scopeLeadsLoading ? "Loading..." : `${filteredSalesTrackerRows.length} shown`}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <input
                value={salesSearch}
                onChange={(e) => setSalesSearch(e.target.value)}
                placeholder="Search BDA, manager, or university"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <select
                value={salesManagerFilter}
                onChange={(e) => setSalesManagerFilter(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="all">All managers</option>
                {salesManagerOptions.map((managerName) => (
                  <option key={managerName} value={managerName}>
                    {managerName}
                  </option>
                ))}
              </select>
              <select
                value={salesSortMode}
                onChange={(e) => setSalesSortMode(e.target.value as "sales_amount_desc" | "loan_amount_desc" | "sales_count_desc")}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="sales_amount_desc">Sort: Sales amount</option>
                <option value="loan_amount_desc">Sort: Loan amount</option>
                <option value="sales_count_desc">Sort: Sales count</option>
              </select>
            </div>

            {scopeLeadsLoading ? (
              <div className="mt-3 text-sm text-slate-500">Loading sales tracker...</div>
            ) : filteredSalesTrackerRows.length === 0 ? (
              <div className="mt-3 text-sm text-slate-500">No closed/enrolled sales found in current scope.</div>
            ) : (
              <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">BDA</th>
                      <th className="px-3 py-2">Manager</th>
                      <th className="px-3 py-2 text-right">Sales</th>
                      <th className="px-3 py-2 text-right">Sales Amount</th>
                      <th className="px-3 py-2 text-right">Loan Amount</th>
                      <th className="px-3 py-2 text-right">Non-Loan</th>
                      <th className="px-3 py-2 text-right">Universities</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredSalesTrackerRows.map((row) => {
                      const expanded = salesExpandedUid === row.uid;
                      return (
                        <tr
                          key={row.uid}
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() =>
                            setSalesExpandedUid((previous) =>
                              previous === row.uid ? null : row.uid,
                            )
                          }
                        >
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900">{row.name}</div>
                            <div className="text-[11px] text-slate-500">{row.uid}</div>
                          </td>
                          <td className="px-3 py-2 text-slate-700">{row.managerName}</td>
                          <td className="px-3 py-2 text-right text-slate-700">{row.salesCount}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">
                            ₹{Intl.NumberFormat("en-IN").format(Math.round(row.salesAmount))}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-amber-700">
                            ₹{Intl.NumberFormat("en-IN").format(Math.round(row.loanAmount))}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                            ₹{Intl.NumberFormat("en-IN").format(Math.round(row.nonLoanAmount))}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {expanded ? "Hide" : `${row.universities.length} items`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {salesExpandedUid ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  University-wise Sales
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {(filteredSalesTrackerRows.find((row) => row.uid === salesExpandedUid)?.universities ?? []).map(
                    (entry) => (
                      <div
                        key={`${salesExpandedUid}-${entry.university}`}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="text-sm font-semibold text-slate-900">{entry.university}</div>
                        <div className="mt-1 text-xs text-slate-600">
                          Sales: {entry.salesCount} | Amount: ₹
                          {Intl.NumberFormat("en-IN").format(Math.round(entry.salesAmount))} | Loan: ₹
                          {Intl.NumberFormat("en-IN").format(Math.round(entry.loanAmount))}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Bi-Weekly Target Scorecards</div>
                <div className="text-xs text-slate-500">
                  14-day cycle engine with rolling 3-cycle compliance for manager and HR intervention.
                </div>
              </div>
              <div className="text-xs text-slate-600">
                In scope BDAs: <span className="font-semibold text-slate-900">{biWeeklySummary.total}</span>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] uppercase text-emerald-700">On Track</div>
                <div className="mt-1 text-lg font-semibold text-emerald-900">{biWeeklySummary.onTrack}</div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-[11px] uppercase text-amber-700">At Risk</div>
                <div className="mt-1 text-lg font-semibold text-amber-900">{biWeeklySummary.atRisk}</div>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                <div className="text-[11px] uppercase text-rose-700">Missed</div>
                <div className="mt-1 text-lg font-semibold text-rose-900">{biWeeklySummary.missed}</div>
              </div>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                <div className="text-[11px] uppercase text-indigo-700">Rolling Sales</div>
                <div className="mt-1 text-lg font-semibold text-indigo-900">
                  {biWeeklySummary.totalRollingSales}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <input
                value={biWeeklySearch}
                onChange={(event) => setBiWeeklySearch(event.target.value)}
                placeholder="Search BDA or manager"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2"
              />
              <select
                value={biWeeklyManagerFilter}
                onChange={(event) => setBiWeeklyManagerFilter(event.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="all">All managers</option>
                {biWeeklyManagerOptions.map((managerName) => (
                  <option key={managerName} value={managerName}>
                    {managerName}
                  </option>
                ))}
              </select>
              <select
                value={biWeeklyStatusFilter}
                onChange={(event) => setBiWeeklyStatusFilter(event.target.value as BiWeeklyStatusFilter)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="all">All statuses</option>
                <option value="on_track">On track</option>
                <option value="at_risk">At risk</option>
                <option value="missed">Missed</option>
              </select>
            </div>

            {filteredBiWeeklyScorecards.length === 0 ? (
              <div className="mt-3 text-sm text-slate-500">
                No BDA scorecards matched this filter set.
              </div>
            ) : (
              <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">BDA</th>
                      <th className="px-3 py-2">Manager</th>
                      <th className="px-3 py-2 text-right">Current Cycle</th>
                      <th className="px-3 py-2 text-right">Rolling 3 Cycles</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Cycle Breakdown</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredBiWeeklyScorecards.map((row) => (
                      <tr key={row.uid}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900">{row.name}</div>
                          <div className="text-[11px] text-slate-500">{row.uid}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{row.managerName}</td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {row.currentCycle.sales}/{row.currentCycle.target}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                          {row.rollingSales}/{row.rollingTarget}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${
                              row.status === "on_track"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : row.status === "at_risk"
                                  ? "border-amber-200 bg-amber-50 text-amber-700"
                                  : "border-rose-200 bg-rose-50 text-rose-700"
                            }`}
                          >
                            {getBiWeeklyStatusLabel(row.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-600">
                          {row.rollingCycles
                            .map((cycle) => `${cycle.label}: ${cycle.sales}/${cycle.target}`)
                            .join(" | ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">PIP Workflow</div>
                <div className="text-xs text-slate-500">
                  Auto-created on missed rolling 3-cycle target. PIP target is 2 sales in the next bi-weekly cycle.
                </div>
              </div>
              <div className="text-xs text-slate-600">
                Cases in scope: <span className="font-semibold text-slate-900">{pipSummary.total}</span>
              </div>
            </div>

            {pipCaseError ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {pipCaseError}
              </div>
            ) : null}

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                <div className="text-[11px] uppercase text-indigo-700">Active</div>
                <div className="mt-1 text-lg font-semibold text-indigo-900">{pipSummary.active}</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] uppercase text-emerald-700">Passed</div>
                <div className="mt-1 text-lg font-semibold text-emerald-900">{pipSummary.passed}</div>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                <div className="text-[11px] uppercase text-rose-700">Failed</div>
                <div className="mt-1 text-lg font-semibold text-rose-900">{pipSummary.failed}</div>
              </div>
            </div>

            {pipCases.length === 0 ? (
              <div className="mt-3 text-sm text-slate-500">
                No PIP cases in this scope.
              </div>
            ) : (
              <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">BDA</th>
                      <th className="px-3 py-2">Trigger</th>
                      <th className="px-3 py-2">PIP Cycle</th>
                      <th className="px-3 py-2 text-right">Progress</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Fail Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {pipCases.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900">{row.bdaName}</div>
                          <div className="text-[11px] text-slate-500">{row.bdaUid}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{row.triggerCycleLabel}</td>
                        <td className="px-3 py-2 text-slate-700">{row.pipCycleLabel}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                          {Number(row.pipAchievedSales || 0)}/{Number(row.pipTargetSales || 2)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${
                              row.status === "active"
                                ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                : row.status === "passed"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-rose-200 bg-rose-50 text-rose-700"
                            }`}
                          >
                            {toTitleCase(row.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {row.status === "failed" && canManagePerformanceActions ? (
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() => void handlePipFailureDecision(row, "extend_inactive")}
                                disabled={pipDecisionLoadingId === row.id}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 disabled:opacity-60"
                              >
                                Extend inactive
                              </button>
                              <button
                                type="button"
                                onClick={() => void handlePipFailureDecision(row, "set_inactive_window")}
                                disabled={pipDecisionLoadingId === row.id}
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                              >
                                Set window
                              </button>
                              <button
                                type="button"
                                onClick={() => void handlePipFailureDecision(row, "terminate")}
                                disabled={pipDecisionLoadingId === row.id}
                                className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                              >
                                Terminate
                              </button>
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-500">
                              {row.failAction ? `Applied: ${String(row.failAction).replace(/_/g, " ")}` : "-"}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Counselling Count + Payout</div>
                <div className="text-xs text-slate-500">
                  Bi-weekly target {COUNSELLING_TARGET_PER_CYCLE} counselling. Incentive = approved count x Rs {COUNSELLING_INCENTIVE_PER_ENTRY}. Payout unlocks only after at least {COUNSELLING_PAYOUT_MIN_ROLLING_SALES} sales in rolling 3 bi-weekly cycles.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-slate-600">{currentCounsellingCycle.cycleLabel}</div>
                <button
                  type="button"
                  onClick={() => downloadCounsellingFinancePayload()}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                >
                  Export finance payload
                </button>
              </div>
            </div>

            {counsellingError ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {counsellingError}
              </div>
            ) : null}

            <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2">BDA</th>
                    <th className="px-3 py-2">Manager</th>
                    <th className="px-3 py-2 text-right">Entered</th>
                    <th className="px-3 py-2 text-right">Approved</th>
                    <th className="px-3 py-2 text-right">Pending</th>
                    <th className="px-3 py-2 text-right">Rejected</th>
                    <th className="px-3 py-2">Eligibility</th>
                    <th className="px-3 py-2 text-right">Payout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {counsellingCycleSummaryRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={8}>
                        No counselling entries in the current cycle.
                      </td>
                    </tr>
                  ) : (
                    counsellingCycleSummaryRows.map((row) => (
                      <tr key={row.bdaUid}>
                        <td className="px-3 py-2 font-semibold text-slate-900">{row.bdaName}</td>
                        <td className="px-3 py-2 text-slate-700">{row.managerName}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{row.enteredCount}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-700">{row.approvedCount}</td>
                        <td className="px-3 py-2 text-right text-amber-700">{row.pendingCount}</td>
                        <td className="px-3 py-2 text-right text-rose-700">{row.rejectedCount}</td>
                        <td className="px-3 py-2">
                          {row.payoutEligible ? (
                            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                              Unlocked
                            </span>
                          ) : (
                            <div>
                              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                                Locked
                              </span>
                              <div className="mt-1 max-w-[220px] text-[10px] text-amber-700">
                                {row.payoutLockedReason ?? "Sales gate not met yet."}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                          Rs {Intl.NumberFormat("en-IN").format(Math.round(row.payoutAmount))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <select
                value={counsellingStatusFilter}
                onChange={(event) => setCounsellingStatusFilter(event.target.value as CounsellingStatusFilter)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="all">All review statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2">BDA</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Count</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Review Note</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredCounsellingEntries.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={6}>
                        No counselling entries matched this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredCounsellingEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900">{entry.bdaName}</div>
                          <div className="text-[11px] text-slate-500">{entry.managerName}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{entry.entryDateKey}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{entry.counsellingCount}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${
                              entry.status === "approved"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : entry.status === "rejected"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                            }`}
                          >
                            {toTitleCase(entry.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-600">{entry.reviewNote || "-"}</td>
                        <td className="px-3 py-2">
                          {entry.status === "pending" && canManagePerformanceActions ? (
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() => void handleCounsellingReview(entry.id, "approved")}
                                disabled={counsellingReviewLoadingId === entry.id}
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-60"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleCounsellingReview(entry.id, "rejected")}
                                disabled={counsellingReviewLoadingId === entry.id}
                                className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-500">-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div><div className="text-sm font-semibold text-slate-900">Hierarchy KPI Packs</div><div className="text-xs text-slate-500">Role-scoped packs from BDA to CEO. Select a role to scope report output.</div></div>
              <button type="button" onClick={() => setRoleFilter("all")} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">Reset role filter</button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {hierarchyPacks.map((pack) => (
                <button key={pack.role} type="button" onClick={() => setRoleFilter(pack.role)} className={`rounded-xl border px-3 py-3 text-left ${roleFilter === pack.role ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-slate-50"}`}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{pack.label}</div>
                  <div className="mt-2 text-xl font-semibold text-slate-900">{pack.total}</div>
                  <div className="mt-1 text-[11px] text-slate-600">Submitted {pack.submitted} | Pending {pack.pending} | Leave {pack.onLeave}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div><div className="text-sm font-semibold text-slate-900">Executive Exception Alerts</div><div className="text-xs text-slate-500">Stale load, overdue follow-up, and transfer backlog for this scoped hierarchy.</div></div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scoped leads {scopeLeads.length}</div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {exceptionAlerts.map((alert) => (
                <div key={alert.id} className={`rounded-xl border px-3 py-3 ${alert.tone}`}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{alert.title}</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">{alert.count}</div>
                  <div className="mt-1 text-xs text-slate-600">{alert.description}</div>
                  <div className="mt-2 space-y-1">
                    {alert.leads.map((lead) => <div key={lead.leadId} className="text-[11px] text-slate-700">#{lead.leadId} | {toTitleCase(lead.name || "Unnamed")}</div>)}
                    {alert.leads.length === 0 ? <div className="text-[11px] text-slate-500">No exceptions.</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Hierarchy scope list</div>
            {loading ? (
              <div className="mt-3 text-sm text-slate-500">Loading hierarchy...</div>
            ) : scopedNodes.length === 0 ? (
              <div className="mt-3 text-sm text-slate-500">No members in this scope.</div>
            ) : (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {scopedNodes.map((n) => (
                  <Link
                    key={n.uid}
                    href={`/reports/${n.uid}`}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition hover:border-indigo-300 hover:bg-indigo-50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {n.displayName || n.email}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatRoleLabel(n.orgRole ?? n.role)} | {statusOf(n).replace("_", " ")}
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-indigo-600">Open depth</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">KPI drill-down lead list</div>
                <div className="text-xs text-slate-500">Active KPI users: {drilldownUserIds.length}</div>
              </div>
              <div className="flex gap-2">
                <Link href="/crm/leads?surface=workbench" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">Open CRM</Link>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <input
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
                placeholder="Search lead list"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2"
              />
              <select
                value={leadStatusFilter}
                onChange={(e) => setLeadStatusFilter(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="all">All statuses</option>
                {["new", "followup", "interested", "paymentfollowup", "not_interested", "closed"].map((status) => (
                  <option key={status} value={status}>
                    {getLeadStatusLabel(status)}
                  </option>
                ))}
              </select>
              <select
                value={leadOwnerFilter}
                onChange={(e) => setLeadOwnerFilter(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="all">All owners</option>
                {drilldownOwnerOptions.map((owner) => (
                  <option key={owner.uid} value={owner.uid}>
                    {owner.label}
                  </option>
                ))}
              </select>
              <select
                value={String(leadListLimit)}
                onChange={(e) => setLeadListLimit(Number(e.target.value) || 150)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-1"
              >
                {[50, 100, 150, 300].map((rowLimit) => (
                  <option key={rowLimit} value={String(rowLimit)}>
                    Show {rowLimit}
                  </option>
                ))}
              </select>
            </div>
            {scopeLeadsLoading ? (
              <div className="mt-3 text-sm text-slate-500">Loading leads...</div>
            ) : filteredLeads.length === 0 ? (
              <div className="mt-3 text-sm text-slate-500">No leads matched.</div>
            ) : (
              <div className="mt-3 max-h-[320px] overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Lead</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Owner</th>
                      <th className="px-3 py-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {visibleDrilldownLeads.map((lead) => (
                      <tr key={lead.leadId}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900">{toTitleCase(lead.name || "Unnamed")}</div>
                          <div className="text-[11px] text-slate-500">#{lead.leadId}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{getLeadStatusLabel(lead.status)}</td>
                        <td className="px-3 py-2 text-slate-700">{users.find((u) => u.uid === getLeadOwnerUid(lead))?.displayName || getLeadOwnerUid(lead) || "-"}</td>
                        <td className="px-3 py-2 text-slate-700">{toDate(lead.updatedAt)?.toLocaleString() || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
