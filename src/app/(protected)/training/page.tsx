"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { qualifyBdaTrainee } from "@/app/actions/hr";
import {
  canQualifyBdaTrainee,
  formatRoleLabel,
  getPrimaryRole,
} from "@/lib/access";
import { db } from "@/lib/firebase/client";
import { useScopedUsers } from "@/lib/hooks/useScopedUsers";
import { isClosedLeadStatus } from "@/lib/leads/status";
import { CANONICAL_DOMAIN_ROUTES } from "@/lib/routes/canonical";
import type { LeadDoc } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";

const TRAINEE_REQUIRED_SALES = 1;
const TRAINEE_WINDOW_DAYS = 15;

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toLeadClosedAt(lead: LeadDoc) {
  return (
    toDate(lead.enrollmentDetails?.closedAt) ??
    toDate(lead.closedAt) ??
    toDate(lead.updatedAt) ??
    toDate(lead.createdAt)
  );
}

function chunk<T>(values: T[], size = 10) {
  const buckets: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    buckets.push(values.slice(index, index + size));
  }
  return buckets;
}

function isTrainee(user: UserDoc | null | undefined) {
  return getPrimaryRole(user) === "BDA_TRAINEE";
}

function canAccessTrainingPage(user: UserDoc | null | undefined) {
  const role = getPrimaryRole(user);
  return role === "BDA_TRAINEE" || role === "BDM_TRAINING" || canQualifyBdaTrainee(user);
}

function getTraineeWindowStart(user: UserDoc) {
  return toDate(user.traineeProgram?.startedAt) ?? toDate(user.createdAt) ?? new Date();
}

function formatDate(value: Date) {
  const dd = String(value.getDate()).padStart(2, "0");
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const yyyy = value.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export default function TrainingDashboardPage() {
  const { userDoc, firebaseUser } = useAuth();
  const { users: scopedUsersWithInactive } = useScopedUsers(userDoc, {
    includeCurrentUser: true,
    includeInactive: true,
  });

  const [leads, setLeads] = useState<LeadDoc[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [leadsReadError, setLeadsReadError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [processingUid, setProcessingUid] = useState<string | null>(null);

  const canQualify = useMemo(() => canQualifyBdaTrainee(userDoc), [userDoc]);
  const primaryRole = getPrimaryRole(userDoc);

  const traineeUsers = useMemo(() => {
    if (!userDoc) return [] as UserDoc[];
    if (isTrainee(userDoc)) return [userDoc];

    const pool = new Map<string, UserDoc>();
    scopedUsersWithInactive.forEach((user) => {
      pool.set(user.uid, user);
    });

    return Array.from(pool.values())
      .filter((user) => isTrainee(user) && String(user.status ?? "").toLowerCase() !== "terminated")
      .sort((left, right) =>
        (left.displayName ?? left.email ?? left.uid).localeCompare(
          right.displayName ?? right.email ?? right.uid,
        ),
      );
  }, [scopedUsersWithInactive, userDoc]);

  const traineeIds = useMemo(() => traineeUsers.map((user) => user.uid), [traineeUsers]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || traineeIds.length === 0) {
      setLeads([]);
      setLoadingLeads(false);
      setLeadsReadError(null);
      return;
    }

    setLoadingLeads(true);
    setLeadsReadError(null);
    const buckets = new Map<string, LeadDoc[]>();
    const listeners = chunk(traineeIds, 10).map((uids, index) =>
      onSnapshot(
        query(collection(firestore, "leads"), where("ownerUid", "in", uids), limit(1200)),
        (snapshot) => {
          buckets.set(
            `owners-${index}`,
            snapshot.docs.map((docRow) => ({
              ...(docRow.data() as LeadDoc),
              leadId: docRow.id,
            })),
          );
          const merged = new Map<string, LeadDoc>();
          buckets.forEach((rows) => rows.forEach((row) => merged.set(row.leadId, row)));
          setLeads(Array.from(merged.values()));
          setLoadingLeads(false);
        },
        (error) => {
          setLeads([]);
          setLoadingLeads(false);
          setLeadsReadError(error?.message || "Unable to load trainee sales preview.");
        },
      ),
    );

    return () => listeners.forEach((stop) => stop());
  }, [traineeIds]);

  const progressRows = useMemo(() => {
    const now = new Date();
    const salesByOwner = new Map<string, LeadDoc[]>();
    leads.forEach((lead) => {
      if (!lead.ownerUid) return;
      if (!isClosedLeadStatus(lead.status)) return;
      if (!salesByOwner.has(lead.ownerUid)) {
        salesByOwner.set(lead.ownerUid, []);
      }
      salesByOwner.get(lead.ownerUid)!.push(lead);
    });

    return traineeUsers.map((trainee) => {
      const start = getTraineeWindowStart(trainee);
      const endExclusive = new Date(start.getTime() + TRAINEE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const sales = (salesByOwner.get(trainee.uid) ?? []).filter((lead) => {
        const closedAt = toLeadClosedAt(lead);
        if (!closedAt) return false;
        return closedAt.getTime() >= start.getTime() && closedAt.getTime() < endExclusive.getTime();
      }).length;

      const elapsedMs = Math.max(0, now.getTime() - start.getTime());
      const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
      const remainingDays = Math.max(0, TRAINEE_WINDOW_DAYS - elapsedDays);
      const eligible = sales >= TRAINEE_REQUIRED_SALES;
      const expired = now.getTime() >= endExclusive.getTime();
      const status = eligible
        ? "ready_to_qualify"
        : expired
          ? "window_expired"
          : remainingDays <= 3
            ? "at_risk"
            : "in_progress";

      return {
        user: trainee,
        start,
        endExclusive,
        sales,
        elapsedDays,
        remainingDays,
        eligible,
        expired,
        status,
      };
    });
  }, [leads, traineeUsers]);

  const summary = useMemo(() => {
    return progressRows.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.eligible) acc.ready += 1;
        if (row.status === "at_risk") acc.atRisk += 1;
        if (row.status === "window_expired") acc.expired += 1;
        return acc;
      },
      {
        total: 0,
        ready: 0,
        atRisk: 0,
        expired: 0,
      },
    );
  }, [progressRows]);

  async function handleQualify(targetUid: string) {
    if (!firebaseUser || !canQualify) return;
    setActionMessage(null);
    setProcessingUid(targetUid);
    try {
      const token = await firebaseUser.getIdToken();
      const result = await qualifyBdaTrainee({
        callerIdToken: token,
        targetUid,
        reason: "Qualified from training dashboard",
      });
      if (!result.success) {
        throw new Error(result.error || "Unable to qualify trainee.");
      }
      setActionMessage(result.message || "Trainee qualified to BDA.");
    } catch (error: unknown) {
      setActionMessage(error instanceof Error ? error.message : "Unable to qualify trainee.");
    } finally {
      setProcessingUid(null);
    }
  }

  return (
    <AuthGate allowIf={(user) => canAccessTrainingPage(user)}>
      <div className="min-h-screen bg-[#F5F5F7] px-4 py-6 text-slate-900 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Training Vertical
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                  BDA Trainee Qualification Dashboard
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  Role: {formatRoleLabel(primaryRole)}. Trainee rule: {TRAINEE_REQUIRED_SALES} sale within {TRAINEE_WINDOW_DAYS} days to qualify as BDA.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={CANONICAL_DOMAIN_ROUTES.CRM}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Open CRM
                </Link>
                <Link
                  href={CANONICAL_DOMAIN_ROUTES.REPORTS}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Open Reports
                </Link>
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase text-slate-500">Total Trainees</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">{summary.total}</div>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="text-[11px] uppercase text-emerald-700">Ready to Qualify</div>
                <div className="mt-1 text-xl font-semibold text-emerald-900">{summary.ready}</div>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-[11px] uppercase text-amber-700">At Risk (3 days)</div>
                <div className="mt-1 text-xl font-semibold text-amber-900">{summary.atRisk}</div>
              </div>
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                <div className="text-[11px] uppercase text-rose-700">Window Expired</div>
                <div className="mt-1 text-xl font-semibold text-rose-900">{summary.expired}</div>
              </div>
            </div>
            {actionMessage ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                {actionMessage}
              </div>
            ) : null}
            {leadsReadError ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Sales preview is currently limited by CRM scope for this account. Qualification still works and is validated server-side.
              </div>
            ) : null}
            <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              Incentive calculations are disabled for `BDA (Trainee)` and start only after qualification to `BDA`.
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Trainee Tracker</h2>
              <div className="text-xs text-slate-500">
                {loadingLeads ? "Loading training data..." : `${progressRows.length} trainee row(s)`}
              </div>
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Trainee</th>
                    <th className="px-3 py-2">Window</th>
                    <th className="px-3 py-2 text-right">Sales</th>
                    <th className="px-3 py-2 text-right">Days Left</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {progressRows.map((row) => {
                    const canRunQualify = canQualify;
                    const statusTone =
                      row.status === "ready_to_qualify"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : row.status === "window_expired"
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : row.status === "at_risk"
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-slate-200 bg-slate-50 text-slate-700";
                    const statusLabel =
                      row.status === "ready_to_qualify"
                        ? "Ready to qualify"
                        : row.status === "window_expired"
                          ? "Window expired"
                          : row.status === "at_risk"
                            ? "At risk"
                            : "In progress";

                    return (
                      <tr key={row.user.uid}>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-slate-900">
                            {row.user.displayName ?? row.user.email ?? row.user.uid}
                          </div>
                          <div className="text-xs text-slate-500">
                            {row.user.employeeId ?? row.user.uid}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-600">
                          {formatDate(row.start)} to {formatDate(new Date(row.endExclusive.getTime() - 24 * 60 * 60 * 1000))}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">
                          {row.sales}/{TRAINEE_REQUIRED_SALES}
                        </td>
                        <td className="px-3 py-3 text-right text-slate-700">{row.remainingDays}</td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {canRunQualify ? (
                            <button
                              type="button"
                              onClick={() => void handleQualify(row.user.uid)}
                              disabled={processingUid === row.user.uid}
                              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              {processingUid === row.user.uid ? "Qualifying..." : "Evaluate & Qualify"}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500">
                              No qualification access
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {progressRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                        No trainees in your current scope.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </AuthGate>
  );
}
