"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import {
  canQualifyBdaTrainee,
  getPrimaryRole,
  isAdminUser,
  isHrUser,
  isManagerUser,
} from "@/lib/access";
import {
  buildBdaBiWeeklyScorecard,
  getBiWeeklyCycleWindow,
  type BdaBiWeeklyScorecard,
} from "@/lib/sales/biweekly-targets";
import { getEffectiveReportsToUid } from "@/lib/sales/hierarchy";
import {
  buildPipCaseFromMissedScorecard,
  evaluatePipCase,
  getPipCaseId,
} from "@/lib/sales/pip";
import {
  aggregateCounsellingByCycle,
  buildCounsellingEntryCycleMeta,
  COUNSELLING_TARGET_PER_CYCLE,
} from "@/lib/sales/counselling";
import { isClosedLeadStatus } from "@/lib/leads/status";
import type { CrmWorkbenchCounts } from "@/lib/crm/workbench";
import type { LeadDoc } from "@/lib/types/crm";
import type { BdaCounsellingEntryDoc, BdaPipCaseDoc } from "@/lib/types/performance";
import type { UserDoc } from "@/lib/types/user";

type Props = {
  userDoc: UserDoc | null;
  scopedUsers: UserDoc[];
  scopedUsersWithInactive: UserDoc[];
  salesLeads: LeadDoc[];
  salesQueues: CrmWorkbenchCounts;
};

type AttendanceOverrideQueueRow = {
  id: string;
  uid: string;
  dateKey: string;
  reason: string;
  actorName: string;
  createdAt: unknown;
};

type DashboardAlert = {
  id: string;
  title: string;
  detail: string;
  tone:
    | "border-amber-200 bg-amber-50 text-amber-800"
    | "border-rose-200 bg-rose-50 text-rose-800"
    | "border-indigo-200 bg-indigo-50 text-indigo-800";
  href: string;
};

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value && "seconds" in value && typeof (value as { seconds?: unknown }).seconds === "number") {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMillis(value: unknown) {
  return toDate(value)?.getTime() ?? 0;
}

function isBdaRole(user: UserDoc | null | undefined) {
  return getPrimaryRole(user) === "BDA";
}

function toLeadOwnerUid(lead: LeadDoc) {
  return lead.ownerUid ?? lead.assignedTo ?? null;
}

function getLeadClosedDate(lead: LeadDoc) {
  return toDate(lead.enrollmentDetails?.closedAt ?? lead.closedAt ?? lead.updatedAt ?? lead.createdAt);
}

function getLeadSalesAmount(lead: LeadDoc) {
  const value = lead.enrollmentDetails?.fee ?? lead.courseFees ?? 0;
  const amount = typeof value === "number" ? value : Number(String(value ?? "0").replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function isLeadOverdue(lead: LeadDoc, dateKey: string) {
  if (isClosedLeadStatus(lead.status)) return false;
  return Boolean(lead.nextFollowUpDateKey && lead.nextFollowUpDateKey < dateKey);
}

function isLeadStale(lead: LeadDoc, now: Date) {
  if (isClosedLeadStatus(lead.status)) return false;
  const marker = toDate(lead.lastActivityAt) ?? toDate(lead.updatedAt) ?? toDate(lead.createdAt);
  if (!marker) return false;
  return now.getTime() - marker.getTime() >= 24 * 60 * 60 * 1000;
}

function chunk<T>(values: T[], size = 10) {
  const buckets: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    buckets.push(values.slice(i, i + size));
  }
  return buckets;
}

export default function RoleDashboardsPanel(props: Props) {
  const primaryRole = getPrimaryRole(props.userDoc);
  const managerOrAbove = isManagerUser(props.userDoc) || isAdminUser(props.userDoc);
  const hrActor = isHrUser(props.userDoc) || isAdminUser(props.userDoc);
  const canOpenTrainingDashboard = canQualifyBdaTrainee(props.userDoc);

  const [pipCases, setPipCases] = useState<BdaPipCaseDoc[]>([]);
  const [pipHydrated, setPipHydrated] = useState(false);
  const [counsellingEntries, setCounsellingEntries] = useState<BdaCounsellingEntryDoc[]>([]);
  const [overrideQueueRows, setOverrideQueueRows] = useState<AttendanceOverrideQueueRow[]>([]);
  const [globalUsers, setGlobalUsers] = useState<UserDoc[]>([]);

  const teamBdas = useMemo(() => {
    if (isBdaRole(props.userDoc)) return props.userDoc ? [props.userDoc] : [];
    return props.scopedUsersWithInactive.filter((user) => getPrimaryRole(user) === "BDA");
  }, [props.scopedUsersWithInactive, props.userDoc]);
  const teamBdaIds = useMemo(() => teamBdas.map((user) => user.uid), [teamBdas]);
  const scopeUidSet = useMemo(
    () => new Set(props.scopedUsersWithInactive.map((user) => user.uid)),
    [props.scopedUsersWithInactive],
  );

  useEffect(() => {
    const firestore = db;
    if (!firestore || !props.userDoc) {
      setPipCases([]);
      setPipHydrated(true);
      return;
    }
    setPipHydrated(false);

    if (isBdaRole(props.userDoc)) {
      return onSnapshot(
        query(collection(firestore, "bda_pip_cases"), where("bdaUid", "==", props.userDoc.uid), limit(150)),
        (snapshot) => {
          const rows = snapshot.docs
            .map((docRow) => ({ ...(docRow.data() as BdaPipCaseDoc), id: docRow.id }))
            .sort((left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt));
          setPipCases(rows);
          setPipHydrated(true);
        },
        () => {
          setPipCases([]);
          setPipHydrated(true);
        },
      );
    }

    if (managerOrAbove && teamBdaIds.length > 0) {
      const buckets = new Map<string, BdaPipCaseDoc[]>();
      const listeners = chunk(teamBdaIds).map((uids, index) =>
        onSnapshot(
          query(collection(firestore, "bda_pip_cases"), where("bdaUid", "in", uids), limit(600)),
          (snapshot) => {
            buckets.set(
              `pip-${index}`,
              snapshot.docs.map((docRow) => ({ ...(docRow.data() as BdaPipCaseDoc), id: docRow.id })),
            );
            const merged = new Map<string, BdaPipCaseDoc>();
            buckets.forEach((rows) => rows.forEach((row) => merged.set(row.id, row)));
            setPipCases(Array.from(merged.values()).sort((left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt)));
            setPipHydrated(true);
          },
          () => {
            setPipCases([]);
            setPipHydrated(true);
          },
        ),
      );
      return () => listeners.forEach((stop) => stop());
    }

    if (hrActor) {
      return onSnapshot(
        query(collection(firestore, "bda_pip_cases"), limit(1500)),
        (snapshot) => {
          const rows = snapshot.docs
            .map((docRow) => ({ ...(docRow.data() as BdaPipCaseDoc), id: docRow.id }))
            .sort((left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt));
          setPipCases(rows);
          setPipHydrated(true);
        },
        () => {
          setPipCases([]);
          setPipHydrated(true);
        },
      );
    }

    setPipCases([]);
    setPipHydrated(true);
    return;
  }, [hrActor, managerOrAbove, props.userDoc, teamBdaIds]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !props.userDoc) {
      setCounsellingEntries([]);
      return;
    }

    if (isBdaRole(props.userDoc)) {
      return onSnapshot(
        query(collection(firestore, "bda_counselling_entries"), where("bdaUid", "==", props.userDoc.uid), limit(500)),
        (snapshot) => {
          const rows = snapshot.docs
            .map((docRow) => ({ ...(docRow.data() as BdaCounsellingEntryDoc), id: docRow.id }))
            .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
          setCounsellingEntries(rows);
        },
        () => setCounsellingEntries([]),
      );
    }

    if (managerOrAbove && teamBdaIds.length > 0) {
      const buckets = new Map<string, BdaCounsellingEntryDoc[]>();
      const listeners = chunk(teamBdaIds).map((uids, index) =>
        onSnapshot(
          query(collection(firestore, "bda_counselling_entries"), where("bdaUid", "in", uids), limit(1200)),
          (snapshot) => {
            buckets.set(
              `counselling-${index}`,
              snapshot.docs.map((docRow) => ({ ...(docRow.data() as BdaCounsellingEntryDoc), id: docRow.id })),
            );
            const merged = new Map<string, BdaCounsellingEntryDoc>();
            buckets.forEach((rows) => rows.forEach((row) => merged.set(row.id, row)));
            setCounsellingEntries(
              Array.from(merged.values()).sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt)),
            );
          },
          () => setCounsellingEntries([]),
        ),
      );
      return () => listeners.forEach((stop) => stop());
    }

    if (hrActor) {
      return onSnapshot(
        query(collection(firestore, "bda_counselling_entries"), limit(2000)),
        (snapshot) => {
          const rows = snapshot.docs
            .map((docRow) => ({ ...(docRow.data() as BdaCounsellingEntryDoc), id: docRow.id }))
            .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
          setCounsellingEntries(rows);
        },
        () => setCounsellingEntries([]),
      );
    }

    setCounsellingEntries([]);
    return;
  }, [hrActor, managerOrAbove, props.userDoc, teamBdaIds]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !props.userDoc || (!hrActor && !managerOrAbove)) {
      setOverrideQueueRows([]);
      return;
    }

    return onSnapshot(
      query(
        collection(firestore, "attendance_override_audit"),
        where("correctionStatus", "==", "pending_hr_review"),
        limit(500),
      ),
      (snapshot) => {
        const rows = snapshot.docs
          .map((entry) => {
            const data = entry.data() as Record<string, unknown>;
            return {
              id: entry.id,
              uid: String(data.uid ?? ""),
              dateKey: String(data.dateKey ?? ""),
              reason: String(data.reason ?? "-"),
              actorName: String((data.actor as { name?: string } | undefined)?.name ?? "-"),
              createdAt: data.createdAt ?? null,
            } satisfies AttendanceOverrideQueueRow;
          })
          .filter((row) => {
            if (hrActor) return true;
            return scopeUidSet.has(row.uid);
          })
          .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
        setOverrideQueueRows(rows);
      },
      () => setOverrideQueueRows([]),
    );
  }, [hrActor, managerOrAbove, props.userDoc, scopeUidSet]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !props.userDoc || !hrActor) {
      setGlobalUsers([]);
      return;
    }

    return onSnapshot(
      query(collection(firestore, "users"), limit(2000)),
      (snapshot) => {
        const rows = snapshot.docs.map((docRow) => ({ ...(docRow.data() as UserDoc), uid: docRow.id }));
        setGlobalUsers(rows);
      },
      () => setGlobalUsers([]),
    );
  }, [hrActor, props.userDoc]);

  const todayKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  const saleDatesByBda = useMemo(() => {
    const map = new Map<string, Date[]>();
    props.salesLeads.forEach((lead) => {
      if (!isClosedLeadStatus(lead.status)) return;
      const ownerUid = toLeadOwnerUid(lead);
      if (!ownerUid) return;
      const closedDate = getLeadClosedDate(lead);
      if (!closedDate) return;
      if (!map.has(ownerUid)) map.set(ownerUid, []);
      map.get(ownerUid)!.push(closedDate);
    });
    return map;
  }, [props.salesLeads]);

  const scorecards = useMemo(() => {
    const rows: BdaBiWeeklyScorecard[] = [];
    teamBdas.forEach((bda) => {
      const managerUid = bda.reportsTo ?? bda.managerId ?? null;
      const managerName =
        props.scopedUsersWithInactive.find((candidate) => candidate.uid === managerUid)?.displayName ??
        managerUid ??
        "-";
      rows.push(
        buildBdaBiWeeklyScorecard({
          uid: bda.uid,
          name: bda.displayName ?? bda.email ?? bda.uid,
          managerName,
          saleDates: saleDatesByBda.get(bda.uid) ?? [],
          referenceDate: new Date(),
        }),
      );
    });
    return rows.sort((left, right) => left.name.localeCompare(right.name));
  }, [props.scopedUsersWithInactive, saleDatesByBda, teamBdas]);

  const currentCycle = useMemo(
    () => buildCounsellingEntryCycleMeta({ date: new Date() }),
    [],
  );
  const counsellingCycleRows = useMemo(
    () =>
      aggregateCounsellingByCycle({
        entries: counsellingEntries,
        cycleIndex: currentCycle.cycleIndex,
      }),
    [counsellingEntries, currentCycle.cycleIndex],
  );

  const counsellingByUid = useMemo(() => {
    const map = new Map<string, (typeof counsellingCycleRows)[number]>();
    counsellingCycleRows.forEach((row) => map.set(row.bdaUid, row));
    return map;
  }, [counsellingCycleRows]);

  const latestPipByBda = useMemo(() => {
    const map = new Map<string, BdaPipCaseDoc>();
    pipCases.forEach((row) => {
      const existing = map.get(row.bdaUid);
      if (!existing || toMillis(row.updatedAt) > toMillis(existing.updatedAt)) {
        map.set(row.bdaUid, row);
      }
    });
    return map;
  }, [pipCases]);

  const pipCasesById = useMemo(() => {
    const map = new Map<string, BdaPipCaseDoc>();
    pipCases.forEach((row) => map.set(row.id, row));
    return map;
  }, [pipCases]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !props.userDoc || !pipHydrated) return;
    if (!managerOrAbove && !hrActor) return;
    if (scorecards.length === 0) return;

    const now = new Date();
    const actor = {
      uid: props.userDoc.uid,
      name: props.userDoc.displayName ?? props.userDoc.email ?? props.userDoc.uid,
      role: String(props.userDoc.orgRole ?? props.userDoc.role ?? ""),
      employeeId: props.userDoc.employeeId ?? null,
    };
    const usersByUid = new Map<string, UserDoc>();
    props.scopedUsersWithInactive.forEach((user) => usersByUid.set(user.uid, user));
    globalUsers.forEach((user) => usersByUid.set(user.uid, user));

    const writes: Promise<unknown>[] = [];
    scorecards
      .filter((row) => row.status === "missed")
      .forEach((row) => {
        const pipId = getPipCaseId(row.uid, row.currentCycle.index);
        if (pipCasesById.has(pipId)) return;

        const bda = usersByUid.get(row.uid);
        const managerUid = bda ? getEffectiveReportsToUid(bda) : null;
        const managerName =
          managerUid
            ? usersByUid.get(managerUid)?.displayName ??
              usersByUid.get(managerUid)?.email ??
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
        const next = evaluatePipCase({
          pipCase: row,
          saleDates: saleDatesByBda.get(row.bdaUid) ?? [],
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
      console.error("Dashboard PIP sync failed", error);
    });
  }, [
    globalUsers,
    hrActor,
    managerOrAbove,
    pipCases,
    pipCasesById,
    pipHydrated,
    props.scopedUsersWithInactive,
    props.userDoc,
    saleDatesByBda,
    scorecards,
  ]);

  const bdaPanel = useMemo(() => {
    if (!props.userDoc || !isBdaRole(props.userDoc)) return null;
    const ownScorecard = scorecards.find((row) => row.uid === props.userDoc!.uid) ?? null;
    const ownCounselling = counsellingByUid.get(props.userDoc.uid) ?? null;
    const ownPip = latestPipByBda.get(props.userDoc.uid) ?? null;
    const ownSalesLeads = props.salesLeads.filter((lead) => {
      const ownerUid = toLeadOwnerUid(lead);
      return ownerUid === props.userDoc?.uid && isClosedLeadStatus(lead.status);
    });
    const salesAmount = ownSalesLeads.reduce((total, lead) => total + getLeadSalesAmount(lead), 0);

    return {
      salesCount: ownSalesLeads.length,
      salesAmount,
      scorecard: ownScorecard,
      counselling: ownCounselling,
      pip: ownPip,
    };
  }, [counsellingByUid, latestPipByBda, props.salesLeads, props.userDoc, scorecards]);

  const teamHeatmapRows = useMemo(() => {
    if (!managerOrAbove) return [];
    const now = new Date();
    return scorecards.map((row) => {
      const counselling = counsellingByUid.get(row.uid);
      const userLeads = props.salesLeads.filter((lead) => toLeadOwnerUid(lead) === row.uid);
      const overdue = userLeads.filter((lead) => isLeadOverdue(lead, todayKey)).length;
      const stale = userLeads.filter((lead) => isLeadStale(lead, now)).length;
      return {
        uid: row.uid,
        name: row.name,
        managerName: row.managerName,
        currentSales: row.currentCycle.sales,
        salesTarget: row.currentCycle.target,
        status: row.status,
        counsellingEntered: counselling?.enteredCount ?? 0,
        counsellingApproved: counselling?.approvedCount ?? 0,
        counsellingTarget: COUNSELLING_TARGET_PER_CYCLE,
        overdue,
        stale,
      };
    });
  }, [counsellingByUid, managerOrAbove, props.salesLeads, scorecards, todayKey]);

  const atRiskRows = useMemo(
    () => teamHeatmapRows.filter((row) => row.status !== "on_track"),
    [teamHeatmapRows],
  );

  const managerOverrideQueue = useMemo(
    () => overrideQueueRows.slice(0, 8),
    [overrideQueueRows],
  );

  const hrPopulation = useMemo(() => {
    const source = hrActor ? globalUsers : props.scopedUsersWithInactive;
    const inactive = source.filter((user) => String(user.status ?? "").toLowerCase() === "inactive");
    const inactiveWithExpiry = inactive.filter((user) => String(user.lifecycleState ?? "") === "inactive_till");
    const activePip = pipCases.filter((row) => row.status === "active").length;
    const failedPip = pipCases.filter((row) => row.status === "failed").length;
    return {
      inactiveCount: inactive.length,
      inactiveWithExpiryCount: inactiveWithExpiry.length,
      activePip,
      failedPip,
    };
  }, [globalUsers, hrActor, pipCases, props.scopedUsersWithInactive]);

  const alerts = useMemo(() => {
    const now = new Date();
    const currentWindow = getBiWeeklyCycleWindow(currentCycle.cycleIndex);
    const hoursLeft = (currentWindow.endExclusive.getTime() - now.getTime()) / (60 * 60 * 1000);
    const closeSoon = hoursLeft > 0 && hoursLeft <= 48;

    const sourceUsers = hrActor ? globalUsers : props.scopedUsersWithInactive;
    const inactivityExpiringSoon = sourceUsers.filter((user) => {
      if (String(user.lifecycleState ?? "") !== "inactive_till") return false;
      const until = toDate(user.inactiveUntil);
      if (!until) return false;
      const diff = until.getTime() - now.getTime();
      return diff >= 0 && diff <= 3 * 24 * 60 * 60 * 1000;
    }).length;

    const recentPipTriggers = pipCases.filter((row) => {
      if (row.status !== "active") return false;
      return now.getTime() - toMillis(row.createdAt) <= 24 * 60 * 60 * 1000;
    }).length;
    const missedTargets = scorecards.filter((row) => row.status === "missed").length;

    const next: DashboardAlert[] = [];
    if (closeSoon) {
      next.push({
        id: "cycle-close",
        title: "Bi-weekly cycle closing soon",
        detail: `${Math.max(1, Math.ceil(hoursLeft / 24))} day(s) left in current cycle (${currentWindow.label}).`,
        tone: "border-amber-200 bg-amber-50 text-amber-800",
        href: "/reports",
      });
    }
    if (missedTargets > 0) {
      next.push({
        id: "target-miss",
        title: "Target miss detected",
        detail: `${missedTargets} BDA(s) are in missed status for rolling target.`,
        tone: "border-rose-200 bg-rose-50 text-rose-800",
        href: "/reports",
      });
    }
    if (recentPipTriggers > 0) {
      next.push({
        id: "pip-trigger",
        title: "New PIP trigger",
        detail: `${recentPipTriggers} new active PIP case(s) in the last 24h.`,
        tone: "border-indigo-200 bg-indigo-50 text-indigo-800",
        href: "/reports",
      });
    }
    if (inactivityExpiringSoon > 0) {
      next.push({
        id: "inactive-expiry",
        title: "Inactivity expiry approaching",
        detail: `${inactivityExpiringSoon} inactive profile(s) expire within 3 days.`,
        tone: "border-amber-200 bg-amber-50 text-amber-800",
        href: "/hr/employees",
      });
    }
    return next.slice(0, 4);
  }, [
    currentCycle.cycleIndex,
    globalUsers,
    hrActor,
    pipCases,
    props.scopedUsersWithInactive,
    scorecards,
  ]);

  if (!props.userDoc) return null;

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Role Dashboard</h2>
          <p className="mt-1 text-xs text-slate-500">
            Scope-aware performance blocks for {primaryRole.replace(/_/g, " ")} with one-click drilldown.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/reports"
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Open reports
          </Link>
          <Link
            href={managerOrAbove ? "/team" : "/crm/leads?surface=workbench"}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Drill down
          </Link>
          {canOpenTrainingDashboard ? (
            <Link
              href="/training"
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Training
            </Link>
          ) : null}
        </div>
      </div>

      {bdaPanel ? (
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] uppercase text-slate-500">Sales (Current Cycle)</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{bdaPanel.salesCount}</div>
            <div className="text-xs text-slate-600">₹{Intl.NumberFormat("en-IN").format(Math.round(bdaPanel.salesAmount))}</div>
          </div>
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
            <div className="text-[11px] uppercase text-indigo-700">Bi-Weekly Target</div>
            <div className="mt-1 text-xl font-semibold text-indigo-900">
              {bdaPanel.scorecard ? `${bdaPanel.scorecard.currentCycle.sales}/${bdaPanel.scorecard.currentCycle.target}` : "-"}
            </div>
            <div className="text-xs text-indigo-700">
              {bdaPanel.scorecard ? bdaPanel.scorecard.status.replace("_", " ") : "No scorecard yet"}
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-[11px] uppercase text-emerald-700">Counselling</div>
            <div className="mt-1 text-xl font-semibold text-emerald-900">
              {bdaPanel.counselling ? bdaPanel.counselling.enteredCount : 0}/{COUNSELLING_TARGET_PER_CYCLE}
            </div>
            <div className="text-xs text-emerald-700">
              Approved: {bdaPanel.counselling?.approvedCount ?? 0}
            </div>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-[11px] uppercase text-amber-700">PIP Status</div>
            <div className="mt-1 text-xl font-semibold text-amber-900">
              {bdaPanel.pip ? bdaPanel.pip.status.replace("_", " ") : "No active PIP"}
            </div>
            <div className="text-xs text-amber-700">
              {bdaPanel.pip ? `${bdaPanel.pip.pipAchievedSales}/${bdaPanel.pip.pipTargetSales}` : "On track"}
            </div>
          </div>
        </div>
      ) : null}

      {managerOrAbove ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 xl:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">Team Heatmap</div>
              <div className="text-[11px] text-slate-600">
                Due today {props.salesQueues.due_today} | Stale {props.salesQueues.no_activity_24h}
              </div>
            </div>
            <div className="mt-2 max-h-[260px] overflow-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2">BDA</th>
                    <th className="px-3 py-2 text-right">Sales</th>
                    <th className="px-3 py-2 text-right">Counselling</th>
                    <th className="px-3 py-2 text-right">Overdue</th>
                    <th className="px-3 py-2 text-right">Stale</th>
                    <th className="px-3 py-2">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teamHeatmapRows.map((row) => (
                    <tr key={row.uid}>
                      <td className="px-3 py-2 font-semibold text-slate-900">{row.name}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{row.currentSales}/{row.salesTarget}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{row.counsellingEntered}/{row.counsellingTarget}</td>
                      <td className="px-3 py-2 text-right text-amber-700">{row.overdue}</td>
                      <td className="px-3 py-2 text-right text-rose-700">{row.stale}</td>
                      <td className="px-3 py-2 text-slate-700">{row.status.replace("_", " ")}</td>
                    </tr>
                  ))}
                  {teamHeatmapRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={6}>No BDA rows in scope.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">At-risk List</div>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">{atRiskRows.length}</span>
              </div>
              <div className="mt-2 space-y-2">
                {atRiskRows.slice(0, 6).map((row) => (
                  <div key={row.uid} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-xs font-semibold text-slate-900">{row.name}</div>
                    <div className="mt-1 text-[11px] text-slate-600">
                      Sales {row.currentSales}/{row.salesTarget} | Status {row.status.replace("_", " ")}
                    </div>
                  </div>
                ))}
                {atRiskRows.length === 0 ? <div className="text-xs text-slate-500">No at-risk BDAs.</div> : null}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">Override Queue</div>
                <Link href="/hr/attendance" className="text-[11px] font-semibold text-slate-700">Open</Link>
              </div>
              <div className="mt-2 space-y-2">
                {managerOverrideQueue.map((row) => (
                  <div key={row.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-xs font-semibold text-slate-900">{row.uid} | {row.dateKey}</div>
                    <div className="mt-1 text-[11px] text-slate-600">{row.reason}</div>
                  </div>
                ))}
                {managerOverrideQueue.length === 0 ? <div className="text-xs text-slate-500">No pending overrides in scope.</div> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {hrActor ? (
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] uppercase text-slate-500">Attendance Override Queue</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{overrideQueueRows.length}</div>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-[11px] uppercase text-amber-700">Inactive Population</div>
            <div className="mt-1 text-xl font-semibold text-amber-900">{hrPopulation.inactiveCount}</div>
          </div>
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
            <div className="text-[11px] uppercase text-indigo-700">Active PIP</div>
            <div className="mt-1 text-xl font-semibold text-indigo-900">{hrPopulation.activePip}</div>
          </div>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
            <div className="text-[11px] uppercase text-rose-700">Failed PIP</div>
            <div className="mt-1 text-xl font-semibold text-rose-900">{hrPopulation.failedPip}</div>
          </div>
        </div>
      ) : null}

      {alerts.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {alerts.map((alert) => (
            <Link
              key={alert.id}
              href={alert.href}
              className={`rounded-2xl border px-3 py-2 text-xs font-medium ${alert.tone}`}
            >
              <div className="text-sm font-semibold">{alert.title}</div>
              <div className="mt-1">{alert.detail}</div>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
