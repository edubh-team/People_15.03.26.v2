"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { createCounsellingEntry } from "@/app/actions/hr";
import RoleDashboardsPanel from "@/components/my-day/RoleDashboardsPanel";
import DirectSaleForm from "@/components/leads/DirectSaleForm";
import { CANONICAL_DOMAIN_ROUTES } from "@/lib/routes/canonical";
import {
  canAccessCrm,
  getCrmScopeUids,
} from "@/lib/crm/access";
import { getLeadOwnerUid } from "@/lib/crm/custody";
import {
  canAccessFinance,
  canPunchNewSale,
  formatRoleLabel,
  getPrimaryRole,
  isHrUser,
} from "@/lib/access";
import { useScopedUsers } from "@/lib/hooks/useScopedUsers";
import { useIdentityScopeUids } from "@/lib/hooks/useIdentityScopeUids";
import { isClosedLeadStatus } from "@/lib/leads/status";
import {
  buildWorkbenchCounts,
  type CrmWorkbenchCounts,
  type CrmWorkbenchTabId,
} from "@/lib/crm/workbench";
import { buildBdaBiWeeklyScorecard } from "@/lib/sales/biweekly-targets";
import type { LeadDoc } from "@/lib/types/crm";
import type {
  FinanceAccountDirectoryResponse,
  FinanceApprovalListResponse,
} from "@/lib/types/finance";
import { db } from "@/lib/firebase/client";
import { usePeoplePayrollSnapshot } from "@/lib/people/payroll-workspace";
import {
  aggregateCounsellingByCycle,
  buildCounsellingEntryCycleMeta,
  COUNSELLING_INCENTIVE_PER_ENTRY,
  COUNSELLING_TARGET_PER_CYCLE,
  toDateKey,
} from "@/lib/sales/counselling";
import {
  BDA_POST_PROBATION_INCENTIVE_SIXTH_ONWARDS,
  BDA_POST_PROBATION_INCENTIVE_UPTO_FIVE,
  BDA_PROBATION_INCENTIVE_PER_SALE,
  COUNSELLING_PAYOUT_MIN_ROLLING_SALES,
  buildBdaMonthlySalesIncentiveSummary,
  isCounsellingPayoutEligible,
} from "@/lib/sales/incentives";
import type { BdaCounsellingEntryDoc, BdaEmiTrackerDoc } from "@/lib/types/performance";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type Query,
} from "firebase/firestore";

type QueueCard = {
  id: string;
  title: string;
  description: string;
  href: string;
  count: number | null;
};

const ZERO_COUNTS: CrmWorkbenchCounts = {
  new_leads: 0,
  worked_leads: 0,
  due_today: 0,
  no_activity_24h: 0,
  payment_follow_up: 0,
  callbacks: 0,
  my_closures: 0,
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

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
  if (typeof value === "object" && value && "seconds" in value && typeof (value as { seconds?: unknown }).seconds === "number") {
    return (value as { seconds: number }).seconds * 1000;
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function toMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toMonthLabel(monthKey: string) {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  const parsed = new Date(year, Math.max(0, month - 1), 1);
  return parsed.toLocaleString("en-IN", { month: "short", year: "numeric" });
}

function toNonNegativeInt(value: string | number | null | undefined) {
  const parsed = Math.trunc(Number(value ?? 0));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function toNonNegativeAmount(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function toLeadDoc(snapshot: { id: string; data: () => DocumentData }) {
  return { ...(snapshot.data() as LeadDoc), leadId: snapshot.id } as LeadDoc;
}

function buildLeadQueries(scopeUids: string[] | null): Array<{ key: string; query: Query }> {
  const firestore = db;
  if (!firestore) return [];
  if (scopeUids === null) {
    return [
      {
        key: "global",
        query: query(
          collection(firestore, "leads"),
          orderBy("updatedAt", "desc"),
          limit(GLOBAL_LIMIT),
        ),
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

function useSalesQueueCounts(input: {
  enabled: boolean;
  scopeUids: string[] | null;
  scopeKey: string;
}) {
  const [counts, setCounts] = useState<CrmWorkbenchCounts>(ZERO_COUNTS);
  const [leads, setLeads] = useState<LeadDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!input.enabled) {
      setCounts(ZERO_COUNTS);
      setLeads([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!db) {
      setCounts(ZERO_COUNTS);
      setLeads([]);
      setLoading(false);
      setError("Firebase is not configured.");
      return;
    }

    const scopedQueries = buildLeadQueries(input.scopeUids);
    if (scopedQueries.length === 0) {
      setCounts(ZERO_COUNTS);
      setLeads([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const buckets = new Map<string, LeadDoc[]>();
    const unsubscribe = scopedQueries.map(({ key, query: leadsQuery }) =>
      onSnapshot(
        leadsQuery,
        (snapshot) => {
          buckets.set(key, snapshot.docs.map((row) => toLeadDoc(row)));
          const merged = new Map<string, LeadDoc>();
          buckets.forEach((rows) => rows.forEach((lead) => merged.set(lead.leadId, lead)));
          const nextLeads = Array.from(merged.values());
          setLeads(nextLeads);
          setCounts(buildWorkbenchCounts(nextLeads));
          setLoading(false);
        },
        (nextError) => {
          setError(nextError.message || "Unable to load sales queues.");
          setLeads([]);
          setLoading(false);
        },
      ),
    );

    return () => unsubscribe.forEach((stop) => stop());
  }, [input.enabled, input.scopeKey, input.scopeUids]);

  return { counts, leads, loading, error };
}

function toCrmQueueHref(tab: CrmWorkbenchTabId) {
  return `${CANONICAL_DOMAIN_ROUTES.CRM}?surface=workbench&tab=${tab}`;
}

function QueueSection({
  title,
  subtitle,
  cards,
  loading,
  error,
}: {
  title: string;
  subtitle: string;
  cards: QueueCard[];
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        {error ? (
          <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {error}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.id}
            href={card.href}
            className="group rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 hover:bg-slate-100"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">{card.title}</div>
              <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                {loading ? "..." : card.count ?? "--"}
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600">{card.description}</p>
            <div className="mt-3 text-xs font-semibold text-indigo-700 group-hover:text-indigo-800">
              Open queue
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function MyDayPage() {
  const { userDoc, firebaseUser } = useAuth();
  const { users: scopedUsers } = useScopedUsers(userDoc, {
    includeCurrentUser: true,
    includeInactive: false,
  });
  const { users: scopedUsersWithInactive } = useScopedUsers(userDoc, {
    includeCurrentUser: true,
    includeInactive: true,
  });
  const canUseSalesQueues = canAccessCrm(userDoc);
  const canOpenDirectSale = canPunchNewSale(userDoc);
  const roleLabel = formatRoleLabel(userDoc?.orgRole ?? userDoc?.role);
  const primaryRole = getPrimaryRole(userDoc);
  const showHrQueues = isHrUser(userDoc);
  const showFinanceQueues = canAccessFinance(userDoc);
  const [showDirectSaleModal, setShowDirectSaleModal] = useState(false);
  const [counsellingDateKey, setCounsellingDateKey] = useState(toDateKey(new Date()));
  const [counsellingCount, setCounsellingCount] = useState("1");
  const [counsellingNotes, setCounsellingNotes] = useState("");
  const [counsellingSubmitting, setCounsellingSubmitting] = useState(false);
  const [counsellingMessage, setCounsellingMessage] = useState<string | null>(null);
  const [counsellingEntries, setCounsellingEntries] = useState<BdaCounsellingEntryDoc[]>([]);
  const [counsellingLoadError, setCounsellingLoadError] = useState<string | null>(null);
  const [emiTracker, setEmiTracker] = useState<BdaEmiTrackerDoc | null>(null);
  const [emiLoadError, setEmiLoadError] = useState<string | null>(null);
  const [emiMessage, setEmiMessage] = useState<string | null>(null);
  const [emiSubmitting, setEmiSubmitting] = useState(false);
  const [emiForm, setEmiForm] = useState({
    loanAmount: "",
    monthlyEmiAmount: "",
    totalEmiCount: "",
    paidEmiCount: "",
  });

  const isBdaUser = primaryRole === "BDA";
  const currentCounsellingCycle = useMemo(
    () => buildCounsellingEntryCycleMeta({ date: new Date() }),
    [],
  );
  const currentMonthKey = useMemo(() => toMonthKey(new Date()), []);
  const currentMonthLabel = useMemo(() => toMonthLabel(currentMonthKey), [currentMonthKey]);
  const identityScopeUids = useIdentityScopeUids(userDoc);

  const scopeUids = useMemo(
    () => {
      if (!canUseSalesQueues) return [];
      const baseScope = getCrmScopeUids(userDoc, scopedUsers);
      if (baseScope === null) return null;
      return Array.from(new Set([...baseScope, ...identityScopeUids]));
    },
    [canUseSalesQueues, identityScopeUids, scopedUsers, userDoc],
  );
  const scopeKey = useMemo(
    () => (scopeUids === null ? "global" : scopeUids.join("|")),
    [scopeUids],
  );

  const salesQueues = useSalesQueueCounts({
    enabled: canUseSalesQueues,
    scopeUids: scopeUids as string[] | null,
    scopeKey,
  });

  const { snapshot: peopleSnapshot, loading: peopleLoading } = usePeoplePayrollSnapshot(
    showHrQueues ? userDoc : null,
    { refreshMs: 60_000 },
  );

  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [financeSummary, setFinanceSummary] = useState<{
    pendingApprovals: number;
    approvedToday: number;
    rejectedToday: number;
    accountDirectorySize: number;
  }>({
    pendingApprovals: 0,
    approvedToday: 0,
    rejectedToday: 0,
    accountDirectorySize: 0,
  });

  function isApprovalListResponse(
    value: FinanceApprovalListResponse | { error?: string },
  ): value is FinanceApprovalListResponse {
    return (
      typeof value === "object" &&
      value !== null &&
      "summary" in value &&
      typeof (value as FinanceApprovalListResponse).summary?.pending === "number"
    );
  }

  function isAccountDirectoryResponse(
    value: FinanceAccountDirectoryResponse | { error?: string },
  ): value is FinanceAccountDirectoryResponse {
    return (
      typeof value === "object" &&
      value !== null &&
      "summary" in value &&
      typeof (value as FinanceAccountDirectoryResponse).summary?.total === "number"
    );
  }

  useEffect(() => {
    if (!showFinanceQueues) {
      setFinanceLoading(false);
      setFinanceError(null);
      return;
    }

    let active = true;
    const load = async () => {
      setFinanceLoading(true);
      setFinanceError(null);
      try {
        const [approvalsRes, accountsRes] = await Promise.all([
          fetch("/api/finance/approvals", { cache: "no-store" }),
          fetch("/api/finance/accounts", { cache: "no-store" }),
        ]);

        if (!approvalsRes.ok) {
          throw new Error("Unable to load finance approvals.");
        }
        if (!accountsRes.ok) {
          throw new Error("Unable to load finance accounts.");
        }

        const approvalsData =
          (await approvalsRes.json()) as FinanceApprovalListResponse | { error?: string };
        const accountsData =
          (await accountsRes.json()) as FinanceAccountDirectoryResponse | { error?: string };

        if (!active) return;
        if ("error" in approvalsData && approvalsData.error) {
          throw new Error(approvalsData.error);
        }
        if ("error" in accountsData && accountsData.error) {
          throw new Error(accountsData.error);
        }
        if (!isApprovalListResponse(approvalsData)) {
          throw new Error("Finance approvals payload is invalid.");
        }
        if (!isAccountDirectoryResponse(accountsData)) {
          throw new Error("Finance accounts payload is invalid.");
        }

        setFinanceSummary({
          pendingApprovals: approvalsData.summary.pending,
          approvedToday: approvalsData.summary.approved,
          rejectedToday: approvalsData.summary.rejected,
          accountDirectorySize: accountsData.summary.total,
        });
      } catch (loadError: unknown) {
        if (!active) return;
        setFinanceError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load finance queues.",
        );
      } finally {
        if (active) setFinanceLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [showFinanceQueues]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !isBdaUser || !userDoc?.uid) {
      setCounsellingEntries([]);
      setCounsellingLoadError(null);
      return;
    }

    setCounsellingLoadError(null);
    return onSnapshot(
      query(
        collection(firestore, "bda_counselling_entries"),
        where("bdaUid", "==", userDoc.uid),
        limit(500),
      ),
      (snapshot) => {
        const rows = snapshot.docs
          .map((row) => ({ ...(row.data() as BdaCounsellingEntryDoc), id: row.id }))
          .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
        setCounsellingEntries(rows);
      },
      (error) => {
        console.error("Failed to load counselling entries", error);
        setCounsellingLoadError(error.message || "Unable to load counselling entries.");
      },
    );
  }, [isBdaUser, userDoc?.uid]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !isBdaUser || !userDoc?.uid) {
      setEmiTracker(null);
      setEmiLoadError(null);
      setEmiForm({
        loanAmount: "",
        monthlyEmiAmount: "",
        totalEmiCount: "",
        paidEmiCount: "",
      });
      return;
    }

    setEmiLoadError(null);
    return onSnapshot(
      doc(firestore, "bda_emi_trackers", userDoc.uid),
      (snapshot) => {
        if (!snapshot.exists()) {
          setEmiTracker(null);
          setEmiForm({
            loanAmount: "",
            monthlyEmiAmount: "",
            totalEmiCount: "",
            paidEmiCount: "",
          });
          return;
        }
        const row = { ...(snapshot.data() as BdaEmiTrackerDoc), id: snapshot.id };
        setEmiTracker(row);
        setEmiForm({
          loanAmount: row.loanAmount ? String(row.loanAmount) : "",
          monthlyEmiAmount: row.monthlyEmiAmount ? String(row.monthlyEmiAmount) : "",
          totalEmiCount: String(toNonNegativeInt(row.totalEmiCount)),
          paidEmiCount: String(toNonNegativeInt(row.paidEmiCount)),
        });
      },
      (error) => {
        console.error("Failed to load EMI tracker", error);
        setEmiLoadError(error.message || "Unable to load EMI tracker.");
      },
    );
  }, [isBdaUser, userDoc?.uid]);

  const ownSaleDates = useMemo(() => {
    if (!isBdaUser || !userDoc?.uid) return [] as Date[];
    return salesQueues.leads
      .map((lead) => {
        if (!isClosedLeadStatus(lead.status)) return null;
        const ownerUid = getLeadOwnerUid(lead);
        if (ownerUid !== userDoc.uid) return null;
        const closedAtMs = toMillis(
          lead.enrollmentDetails?.closedAt ?? lead.closedAt ?? lead.updatedAt ?? lead.createdAt,
        );
        if (!closedAtMs) return null;
        return new Date(closedAtMs);
      })
      .filter((value): value is Date => value instanceof Date);
  }, [isBdaUser, salesQueues.leads, userDoc?.uid]);

  const ownBiWeeklyScorecard = useMemo(() => {
    if (!isBdaUser || !userDoc?.uid) return null;
    return buildBdaBiWeeklyScorecard({
      uid: userDoc.uid,
      name: userDoc.displayName || userDoc.email || userDoc.uid,
      managerName: "-",
      saleDates: ownSaleDates,
      referenceDate: new Date(),
    });
  }, [isBdaUser, ownSaleDates, userDoc]);

  const counsellingPayoutEligible = useMemo(
    () => isCounsellingPayoutEligible(ownBiWeeklyScorecard?.rollingSales ?? 0),
    [ownBiWeeklyScorecard?.rollingSales],
  );

  const monthlySalesIncentive = useMemo(
    () =>
      buildBdaMonthlySalesIncentiveSummary({
        saleDates: ownSaleDates,
        user: userDoc,
        referenceDate: new Date(),
      }),
    [ownSaleDates, userDoc],
  );

  const emiDisplay = useMemo(() => {
    const total = toNonNegativeInt(emiForm.totalEmiCount);
    const paid = Math.min(toNonNegativeInt(emiForm.paidEmiCount), total);
    const remaining = Math.max(total - paid, 0);
    const monthWise = emiTracker?.monthWisePaid ?? {};
    const currentMonthPaid = toNonNegativeInt(monthWise[currentMonthKey] ?? 0);
    return {
      total,
      paid,
      remaining,
      currentMonthPaid,
      monthlyEmiAmount: toNonNegativeAmount(emiForm.monthlyEmiAmount),
      loanAmount: emiForm.loanAmount.trim() ? toNonNegativeAmount(emiForm.loanAmount) : null,
    };
  }, [
    currentMonthKey,
    emiForm.loanAmount,
    emiForm.monthlyEmiAmount,
    emiForm.paidEmiCount,
    emiForm.totalEmiCount,
    emiTracker?.monthWisePaid,
  ]);

  const emiMonthHistory = useMemo(
    () =>
      Object.entries(emiTracker?.monthWisePaid ?? {})
        .map(([monthKey, count]) => ({
          monthKey,
          monthLabel: toMonthLabel(monthKey),
          count: toNonNegativeInt(count),
        }))
        .sort((left, right) => right.monthKey.localeCompare(left.monthKey))
        .slice(0, 6),
    [emiTracker?.monthWisePaid],
  );

  const counsellingCycleSummary = useMemo(() => {
    if (!userDoc?.uid) {
      return {
        enteredCount: 0,
        approvedCount: 0,
        pendingCount: 0,
        rejectedCount: 0,
        payoutEligible: false,
        payoutLockedReason:
          "Payout locked until BDA reaches 3 sales across the rolling 3 bi-weekly cycles.",
        payoutAmount: 0,
      };
    }
    const summary = aggregateCounsellingByCycle({
      entries: counsellingEntries,
      cycleIndex: currentCounsellingCycle.cycleIndex,
      payoutEligibilityByBda: new Map([[userDoc.uid, counsellingPayoutEligible]]),
    }).find((row) => row.bdaUid === userDoc.uid);
    if (!summary) {
      return {
        enteredCount: 0,
        approvedCount: 0,
        pendingCount: 0,
        rejectedCount: 0,
        payoutEligible: counsellingPayoutEligible,
        payoutLockedReason: counsellingPayoutEligible
          ? null
          : "Payout locked until BDA reaches 3 sales across the rolling 3 bi-weekly cycles.",
        payoutAmount: 0,
      };
    }
    return summary;
  }, [
    counsellingEntries,
    counsellingPayoutEligible,
    currentCounsellingCycle.cycleIndex,
    userDoc?.uid,
  ]);

  async function handleCounsellingSubmit() {
    if (!firebaseUser || !isBdaUser) return;
    const count = Math.max(0, Math.trunc(Number(counsellingCount || 0)));
    if (count <= 0) {
      setCounsellingMessage("Enter a counselling count greater than 0.");
      return;
    }

    setCounsellingSubmitting(true);
    setCounsellingMessage(null);
    try {
      const token = await firebaseUser.getIdToken();
      const result = await createCounsellingEntry({
        callerIdToken: token,
        entryDateKey: counsellingDateKey,
        counsellingCount: count,
        notes: counsellingNotes.trim() || null,
      });
      if (!result.success) {
        throw new Error(result.error || "Unable to submit counselling entry.");
      }
      setCounsellingCount("1");
      setCounsellingNotes("");
      setCounsellingMessage("Counselling entry submitted for manager/HR review.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to submit counselling entry.";
      setCounsellingMessage(message);
    } finally {
      setCounsellingSubmitting(false);
    }
  }

  async function handleEmiTrackerSave() {
    if (!db || !isBdaUser || !userDoc?.uid) return;
    const totalEmiCount = toNonNegativeInt(emiForm.totalEmiCount);
    if (totalEmiCount <= 0) {
      setEmiMessage("Set total EMI count greater than 0.");
      return;
    }

    const paidEmiCount = Math.min(toNonNegativeInt(emiForm.paidEmiCount), totalEmiCount);
    const monthlyEmiAmount = toNonNegativeAmount(emiForm.monthlyEmiAmount);
    const loanAmount = emiForm.loanAmount.trim()
      ? toNonNegativeAmount(emiForm.loanAmount)
      : null;

    const monthWisePaid = { ...(emiTracker?.monthWisePaid ?? {}) } as Record<string, number>;
    const previousPaid = toNonNegativeInt(emiTracker?.paidEmiCount ?? 0);
    const delta = paidEmiCount - previousPaid;
    if (delta !== 0) {
      monthWisePaid[currentMonthKey] = Math.max(0, toNonNegativeInt(monthWisePaid[currentMonthKey] ?? 0) + delta);
      if (monthWisePaid[currentMonthKey] === 0) delete monthWisePaid[currentMonthKey];
    }

    setEmiSubmitting(true);
    setEmiMessage(null);
    try {
      await setDoc(
        doc(db, "bda_emi_trackers", userDoc.uid),
        {
          bdaUid: userDoc.uid,
          bdaName: userDoc.displayName ?? userDoc.email ?? userDoc.uid,
          totalEmiCount,
          paidEmiCount,
          remainingEmiCount: Math.max(totalEmiCount - paidEmiCount, 0),
          monthlyEmiAmount,
          loanAmount,
          monthWisePaid,
          createdAt: emiTracker?.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: {
            uid: userDoc.uid,
            name: userDoc.displayName ?? userDoc.email ?? userDoc.uid,
            role: String(userDoc.orgRole ?? userDoc.role ?? "BDA"),
            employeeId: userDoc.employeeId ?? null,
          },
        },
        { merge: true },
      );
      setEmiMessage("EMI tracker saved.");
    } catch (error: unknown) {
      setEmiMessage(error instanceof Error ? error.message : "Unable to save EMI tracker.");
    } finally {
      setEmiSubmitting(false);
    }
  }

  async function handleMarkMonthlyEmiPaid() {
    if (!db || !isBdaUser || !userDoc?.uid) return;
    const totalEmiCount = toNonNegativeInt(emiForm.totalEmiCount);
    if (totalEmiCount <= 0) {
      setEmiMessage("Set total EMI count before marking monthly EMI paid.");
      return;
    }
    const currentPaid = Math.min(toNonNegativeInt(emiForm.paidEmiCount), totalEmiCount);
    if (currentPaid >= totalEmiCount) {
      setEmiMessage("All EMIs are already marked as paid.");
      return;
    }

    const nextPaid = currentPaid + 1;
    const monthWisePaid = { ...(emiTracker?.monthWisePaid ?? {}) } as Record<string, number>;
    monthWisePaid[currentMonthKey] = toNonNegativeInt(monthWisePaid[currentMonthKey] ?? 0) + 1;

    setEmiSubmitting(true);
    setEmiMessage(null);
    try {
      await setDoc(
        doc(db, "bda_emi_trackers", userDoc.uid),
        {
          bdaUid: userDoc.uid,
          bdaName: userDoc.displayName ?? userDoc.email ?? userDoc.uid,
          totalEmiCount,
          paidEmiCount: nextPaid,
          remainingEmiCount: Math.max(totalEmiCount - nextPaid, 0),
          monthlyEmiAmount: toNonNegativeAmount(emiForm.monthlyEmiAmount),
          loanAmount: emiForm.loanAmount.trim() ? toNonNegativeAmount(emiForm.loanAmount) : null,
          monthWisePaid,
          createdAt: emiTracker?.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: {
            uid: userDoc.uid,
            name: userDoc.displayName ?? userDoc.email ?? userDoc.uid,
            role: String(userDoc.orgRole ?? userDoc.role ?? "BDA"),
            employeeId: userDoc.employeeId ?? null,
          },
        },
        { merge: true },
      );
      setEmiForm((previous) => ({ ...previous, paidEmiCount: String(nextPaid) }));
      setEmiMessage(`EMI marked for ${currentMonthLabel}.`);
    } catch (error: unknown) {
      setEmiMessage(error instanceof Error ? error.message : "Unable to mark monthly EMI.");
    } finally {
      setEmiSubmitting(false);
    }
  }

  const salesCards = useMemo<QueueCard[]>(
    () => [
      {
        id: "new_leads",
        title: "New Leads",
        description: "First-touch queue. Start here to avoid aging fresh leads.",
        href: toCrmQueueHref("new_leads"),
        count: salesQueues.counts.new_leads,
      },
      {
        id: "due_today",
        title: "Due Today",
        description: "Follow-ups committed for today. Clear this queue first.",
        href: toCrmQueueHref("due_today"),
        count: salesQueues.counts.due_today,
      },
      {
        id: "no_activity_24h",
        title: "No Activity 24h",
        description: "Stale leads needing immediate intervention.",
        href: toCrmQueueHref("no_activity_24h"),
        count: salesQueues.counts.no_activity_24h,
      },
      {
        id: "payment_follow_up",
        title: "Payment Follow Up",
        description: "Revenue-stage deals where momentum must be preserved.",
        href: toCrmQueueHref("payment_follow_up"),
        count: salesQueues.counts.payment_follow_up,
      },
      {
        id: "callbacks",
        title: "Callbacks",
        description: "Promised callbacks and warm conversations to close next.",
        href: toCrmQueueHref("callbacks"),
        count: salesQueues.counts.callbacks,
      },
      {
        id: "my_closures",
        title: "My Closures",
        description: "Won leads and closure review queue for follow-through.",
        href: toCrmQueueHref("my_closures"),
        count: salesQueues.counts.my_closures,
      },
    ],
    [salesQueues.counts],
  );

  const hrCards = useMemo<QueueCard[]>(
    () => [
      {
        id: "hr-attendance",
        title: "Attendance Exceptions",
        description: "Present vs late/absent review for the current day.",
        href: "/hr/attendance",
        count: peopleSnapshot.attendanceLate + peopleSnapshot.attendanceAbsent,
      },
      {
        id: "hr-leaves",
        title: "Pending Leaves",
        description: "Approval queue for pending leave applications.",
        href: "/hr/leaves",
        count: peopleSnapshot.pendingLeavesScoped,
      },
      {
        id: "hr-recruitment",
        title: "Recruitment Pipeline",
        description: "Active candidates that need screening or movement.",
        href: "/hr/recruitment",
        count: peopleSnapshot.activeCandidates,
      },
      {
        id: "hr-payroll",
        title: "Payroll Ready Gap",
        description: "Employees pending payroll completion for the current month.",
        href: "/hr/payroll",
        count: peopleSnapshot.pendingPayrollEmployees,
      },
    ],
    [peopleSnapshot],
  );

  const financeCards = useMemo<QueueCard[]>(
    () => [
      {
        id: "finance-approvals",
        title: "Pending Approvals",
        description: "Maker-checker items waiting for finance review.",
        href: "/finance?view=approvals",
        count: financeSummary.pendingApprovals,
      },
      {
        id: "finance-audit",
        title: "Approved",
        description: "Recently approved requests for audit tracking.",
        href: "/finance?view=approvals",
        count: financeSummary.approvedToday,
      },
      {
        id: "finance-rejected",
        title: "Rejected",
        description: "Rejected approvals to resolve and resubmit quickly.",
        href: "/finance?view=approvals",
        count: financeSummary.rejectedToday,
      },
      {
        id: "finance-accounts",
        title: "Account Directory",
        description: "Managed payout accounts available for transaction mapping.",
        href: "/finance/accounts",
        count: financeSummary.accountDirectorySize,
      },
    ],
    [financeSummary],
  );

  const logSummaryCards = useMemo<QueueCard[]>(() => {
    const cards: QueueCard[] = [];

    if (canUseSalesQueues) {
      cards.push(
        {
          id: "log-sales-backlog",
          title: "Sales Follow-up Backlog",
          description: "Due today and callback leads waiting for action.",
          href: toCrmQueueHref("due_today"),
          count: salesQueues.counts.due_today + salesQueues.counts.callbacks,
        },
        {
          id: "log-sales-stale",
          title: "Stale Lead Recovery",
          description: "No-activity leads older than 24 hours.",
          href: toCrmQueueHref("no_activity_24h"),
          count: salesQueues.counts.no_activity_24h,
        },
        {
          id: "log-sales-closures",
          title: "Closures Logged",
          description: "Current closure queue for verification and handoff.",
          href: toCrmQueueHref("my_closures"),
          count: salesQueues.counts.my_closures,
        },
      );
    }

    if (showHrQueues) {
      cards.push(
        {
          id: "log-hr-leaves",
          title: "Pending Leave Decisions",
          description: "Requests that still need HR/manager action.",
          href: "/hr/leaves",
          count: peopleSnapshot.pendingLeavesScoped,
        },
        {
          id: "log-hr-attendance",
          title: "Attendance Exceptions",
          description: "Late/absent records requiring review.",
          href: "/hr/attendance",
          count: peopleSnapshot.attendanceLate + peopleSnapshot.attendanceAbsent,
        },
      );
    }

    if (showFinanceQueues) {
      cards.push(
        {
          id: "log-finance-pending",
          title: "Finance Pending Approvals",
          description: "Maker-checker approvals waiting in queue.",
          href: "/finance?view=approvals",
          count: financeSummary.pendingApprovals,
        },
        {
          id: "log-finance-rejected",
          title: "Finance Rejected Items",
          description: "Requests rejected and awaiting correction.",
          href: "/finance?view=approvals",
          count: financeSummary.rejectedToday,
        },
      );
    }

    if (cards.length === 0) {
      cards.push(
        {
          id: "log-default-tasks",
          title: "My Tasks",
          description: "Open and in-progress tasks assigned to you.",
          href: "/tasks",
          count: null,
        },
        {
          id: "log-default-attendance",
          title: "Attendance",
          description: "Check-in history and leave status.",
          href: "/attendance",
          count: null,
        },
      );
    }

    return cards.slice(0, 6);
  }, [
    canUseSalesQueues,
    financeSummary.pendingApprovals,
    financeSummary.rejectedToday,
    peopleSnapshot.attendanceAbsent,
    peopleSnapshot.attendanceLate,
    peopleSnapshot.pendingLeavesScoped,
    salesQueues.counts.callbacks,
    salesQueues.counts.due_today,
    salesQueues.counts.my_closures,
    salesQueues.counts.no_activity_24h,
    showFinanceQueues,
    showHrQueues,
  ]);

  return (
    <AuthGate>
      <div className="min-h-screen bg-[#F5F5F7] px-4 py-6 text-slate-900 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  My Day
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                  Action Queues, Not Module Hunting
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  Signed in as {roleLabel}. Start from the queues below and move only on action.
                </p>
              </div>
              <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                Role: {formatRoleLabel(primaryRole)}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {canOpenDirectSale ? (
                <button
                  type="button"
                  onClick={() => setShowDirectSaleModal(true)}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                >
                  Punch New Sale
                </button>
              ) : null}
              <Link
                href={CANONICAL_DOMAIN_ROUTES.CRM}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Open CRM
              </Link>
              <Link
                href="/tasks"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Open Tasks
              </Link>
              <Link
                href={CANONICAL_DOMAIN_ROUTES.REPORTS}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Open Reports
              </Link>
            </div>
          </section>

          <RoleDashboardsPanel
            userDoc={userDoc}
            scopedUsers={scopedUsers}
            scopedUsersWithInactive={scopedUsersWithInactive}
            salesLeads={salesQueues.leads}
            salesQueues={salesQueues.counts}
          />

          {isBdaUser ? (
            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Counselling Tracker</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Bi-weekly target {COUNSELLING_TARGET_PER_CYCLE}. Incentive = approved counselling x Rs {COUNSELLING_INCENTIVE_PER_ENTRY}. Payout unlocks only after {COUNSELLING_PAYOUT_MIN_ROLLING_SALES} sales in rolling 3 bi-weekly cycles.
                  </p>
                </div>
                <div className="text-xs font-semibold text-slate-600">{currentCounsellingCycle.cycleLabel}</div>
              </div>

              <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3">
                <div className="text-sm font-semibold text-indigo-900">Sales Incentive Tracker (Current Month)</div>
                <div className="mt-1 text-xs text-indigo-800">
                  {monthlySalesIncentive.probation
                    ? `Probation slab active: Rs ${BDA_PROBATION_INCENTIVE_PER_SALE} per sale (first 6 months).`
                    : `Post-probation slab: 1st Rs ${BDA_POST_PROBATION_INCENTIVE_UPTO_FIVE[0]}, 2nd Rs ${BDA_POST_PROBATION_INCENTIVE_UPTO_FIVE[1]}, 3rd Rs ${BDA_POST_PROBATION_INCENTIVE_UPTO_FIVE[2]}, 4th Rs ${BDA_POST_PROBATION_INCENTIVE_UPTO_FIVE[3]}, 5th Rs ${BDA_POST_PROBATION_INCENTIVE_UPTO_FIVE[4]}, 6th+ Rs ${BDA_POST_PROBATION_INCENTIVE_SIXTH_ONWARDS} each sale.`}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2">
                    <div className="text-[11px] uppercase text-indigo-700">Month Sales</div>
                    <div className="mt-1 text-lg font-semibold text-indigo-900">{monthlySalesIncentive.monthSalesCount}</div>
                  </div>
                  <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2">
                    <div className="text-[11px] uppercase text-indigo-700">Est. Sales Incentive</div>
                    <div className="mt-1 text-lg font-semibold text-indigo-900">Rs {monthlySalesIncentive.incentiveAmount}</div>
                  </div>
                  <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2">
                    <div className="text-[11px] uppercase text-indigo-700">Counselling Gate</div>
                    <div className="mt-1 text-lg font-semibold text-indigo-900">
                      {ownBiWeeklyScorecard?.rollingSales ?? 0}/{COUNSELLING_PAYOUT_MIN_ROLLING_SALES}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-sky-900">EMI Tracker (Loan)</div>
                  <div className="text-xs font-semibold text-sky-700">{currentMonthLabel}</div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border border-sky-200 bg-white px-3 py-2">
                    <div className="text-[11px] uppercase text-sky-700">Paid EMIs</div>
                    <div className="mt-1 text-lg font-semibold text-sky-900">
                      {emiDisplay.paid}/{emiDisplay.total || 0}
                    </div>
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-white px-3 py-2">
                    <div className="text-[11px] uppercase text-sky-700">Remaining</div>
                    <div className="mt-1 text-lg font-semibold text-sky-900">{emiDisplay.remaining}</div>
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-white px-3 py-2">
                    <div className="text-[11px] uppercase text-sky-700">This Month Paid</div>
                    <div className="mt-1 text-lg font-semibold text-sky-900">{emiDisplay.currentMonthPaid}</div>
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-white px-3 py-2">
                    <div className="text-[11px] uppercase text-sky-700">Monthly EMI</div>
                    <div className="mt-1 text-lg font-semibold text-sky-900">
                      Rs {Intl.NumberFormat("en-IN").format(Math.round(emiDisplay.monthlyEmiAmount))}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  <input
                    type="number"
                    min={0}
                    value={emiForm.loanAmount}
                    onChange={(event) =>
                      setEmiForm((previous) => ({ ...previous, loanAmount: event.target.value }))
                    }
                    placeholder="Loan amount"
                    className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    min={0}
                    value={emiForm.monthlyEmiAmount}
                    onChange={(event) =>
                      setEmiForm((previous) => ({ ...previous, monthlyEmiAmount: event.target.value }))
                    }
                    placeholder="Monthly EMI amount"
                    className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    min={1}
                    value={emiForm.totalEmiCount}
                    onChange={(event) =>
                      setEmiForm((previous) => ({ ...previous, totalEmiCount: event.target.value }))
                    }
                    placeholder="Total EMI count"
                    className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    min={0}
                    value={emiForm.paidEmiCount}
                    onChange={(event) =>
                      setEmiForm((previous) => ({ ...previous, paidEmiCount: event.target.value }))
                    }
                    placeholder="Paid EMI count"
                    className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm"
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleEmiTrackerSave()}
                    disabled={emiSubmitting}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {emiSubmitting ? "Saving EMI..." : "Save EMI tracker"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleMarkMonthlyEmiPaid()}
                    disabled={emiSubmitting}
                    className="rounded-xl border border-sky-300 bg-white px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-60"
                  >
                    Mark EMI paid ({currentMonthLabel})
                  </button>
                </div>

                {emiMonthHistory.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {emiMonthHistory.map((row) => (
                      <div
                        key={row.monthKey}
                        className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-800"
                      >
                        {row.monthLabel}: {row.count}
                      </div>
                    ))}
                  </div>
                ) : null}
                {emiDisplay.loanAmount != null ? (
                  <div className="mt-2 text-xs text-sky-800">
                    Loan amount: Rs {Intl.NumberFormat("en-IN").format(Math.round(emiDisplay.loanAmount))}
                  </div>
                ) : null}
                {emiLoadError ? (
                  <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {emiLoadError}
                  </div>
                ) : null}
                {emiMessage ? <div className="mt-2 text-xs text-sky-800">{emiMessage}</div> : null}
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] uppercase text-slate-500">Entered</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{counsellingCycleSummary.enteredCount}</div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <div className="text-[11px] uppercase text-emerald-700">Approved</div>
                  <div className="mt-1 text-lg font-semibold text-emerald-900">{counsellingCycleSummary.approvedCount}</div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="text-[11px] uppercase text-amber-700">Pending</div>
                  <div className="mt-1 text-lg font-semibold text-amber-900">{counsellingCycleSummary.pendingCount}</div>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                  <div className="text-[11px] uppercase text-indigo-700">Target Left</div>
                  <div className="mt-1 text-lg font-semibold text-indigo-900">
                    {Math.max(COUNSELLING_TARGET_PER_CYCLE - counsellingCycleSummary.enteredCount, 0)}
                  </div>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                  <div className="text-[11px] uppercase text-indigo-700">Sales Gate</div>
                  <div className="mt-1 text-lg font-semibold text-indigo-900">
                    {ownBiWeeklyScorecard?.rollingSales ?? 0}/{COUNSELLING_PAYOUT_MIN_ROLLING_SALES}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] uppercase text-slate-500">Incentive</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    Rs {counsellingCycleSummary.payoutAmount}
                  </div>
                </div>
              </div>

              {!counsellingCycleSummary.payoutEligible ? (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {counsellingCycleSummary.payoutLockedReason ??
                    "Counselling payout is locked until rolling sales gate is met."}
                </div>
              ) : null}

              <div className="mt-3 grid gap-2 md:grid-cols-5">
                <input
                  type="date"
                  value={counsellingDateKey}
                  onChange={(event) => setCounsellingDateKey(event.target.value)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={counsellingCount}
                  onChange={(event) => setCounsellingCount(event.target.value)}
                  placeholder="Count"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <input
                  value={counsellingNotes}
                  onChange={(event) => setCounsellingNotes(event.target.value)}
                  placeholder="Optional note"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2"
                />
                <button
                  type="button"
                  onClick={() => void handleCounsellingSubmit()}
                  disabled={counsellingSubmitting}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {counsellingSubmitting ? "Saving..." : "Add counselling"}
                </button>
              </div>

              {counsellingMessage ? (
                <div className="mt-2 text-xs text-slate-600">{counsellingMessage}</div>
              ) : null}
              {counsellingLoadError ? (
                <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {counsellingLoadError}
                </div>
              ) : null}
            </section>
          ) : null}

          {canUseSalesQueues ? (
            <QueueSection
              title="Sales Execution"
              subtitle="Live CRM smart queues for BDAs and managers."
              cards={salesCards}
              loading={salesQueues.loading}
              error={salesQueues.error}
            />
          ) : null}

          {showHrQueues ? (
            <QueueSection
              title="People Operations"
              subtitle="Attendance, leaves, recruitment, and payroll actions."
              cards={hrCards}
              loading={peopleLoading}
            />
          ) : null}

          {showFinanceQueues ? (
            <QueueSection
              title="Finance Operations"
              subtitle="Maker-checker approvals and payout control queues."
              cards={financeCards}
              loading={financeLoading}
              error={financeError}
            />
          ) : null}

          <QueueSection
            title="Live Log Summary"
            subtitle="Role-wise operational snapshot with one-click drilldown."
            cards={logSummaryCards}
            loading={salesQueues.loading || peopleLoading || financeLoading}
          />

          <Transition show={showDirectSaleModal} as={Fragment}>
            <Dialog
              onClose={() => setShowDirectSaleModal(false)}
              className="relative z-50"
            >
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
              </TransitionChild>

              <div className="fixed inset-0 flex items-center justify-center p-4">
                <TransitionChild
                  as={Fragment}
                  enter="transform transition ease-in-out duration-300"
                  enterFrom="scale-95 opacity-0"
                  enterTo="scale-100 opacity-100"
                  leave="transform transition ease-in-out duration-200"
                  leaveFrom="scale-100 opacity-100"
                  leaveTo="scale-95 opacity-0"
                >
                  <DialogPanel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white shadow-xl transition-all">
                    <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
                      <DialogTitle className="text-lg font-bold text-slate-900">
                        Direct Sale Punch
                      </DialogTitle>
                      <p className="mt-1 text-xs text-slate-500">
                        Manually enter a sale for a walk-in or direct lead.
                      </p>
                    </div>
                    <div className="max-h-[80vh] overflow-y-auto p-6">
                      <DirectSaleForm
                        onSuccess={() => setShowDirectSaleModal(false)}
                        onCancel={() => setShowDirectSaleModal(false)}
                      />
                    </div>
                  </DialogPanel>
                </TransitionChild>
              </div>
            </Dialog>
          </Transition>
        </div>
      </div>
    </AuthGate>
  );
}

