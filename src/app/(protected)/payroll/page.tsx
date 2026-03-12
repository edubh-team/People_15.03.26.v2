"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowRightIcon,
  BanknotesIcon,
  BuildingLibraryIcon,
  CurrencyRupeeIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { isAdminUser, isHrUser } from "@/lib/access";
import {
  getPayrollScopeLabel,
  getPayrollSubviews,
  usePeoplePayrollSnapshot,
} from "@/lib/people/payroll-workspace";

export default function PayrollOpsPage() {
  const { userDoc } = useAuth();
  const selectedMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const { snapshot, loading } = usePeoplePayrollSnapshot(userDoc, {
    monthKey: selectedMonth,
    refreshMs: 45_000,
  });

  const adminOnly = isAdminUser(userDoc);
  const iconBySubview = {
    run_payroll: CurrencyRupeeIcon,
    compensation_adjustments: BanknotesIcon,
    secure_vault: ShieldCheckIcon,
  } as const;
  const actions = getPayrollSubviews(userDoc, snapshot).map((subview) => ({
    ...subview,
    icon: iconBySubview[subview.key],
  }));
  const scopeLabel = getPayrollScopeLabel(userDoc);
  const recentPayrolls = snapshot.recentPayrollRows.slice(0, 6);

  return (
    <AuthGate allowIf={(user) => isHrUser(user) || isAdminUser(user)}>
      <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-8">
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-rose-100 bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">
                  Payroll Ops
                </div>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                  Unified Payroll Workspace
                </h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  Use this as the primary payroll entrypoint. Deep payroll screens are retained as permissioned subviews until full parity is completed.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {loading ? "Refreshing payroll signals..." : `Month in focus: ${selectedMonth}`}
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {[
                {
                  label: "Active Employees",
                  value: snapshot.activeEmployees,
                  tone: "bg-slate-100 text-slate-800",
                },
                {
                  label: "Payroll Records",
                  value: snapshot.payrollRecords,
                  tone: "bg-indigo-100 text-indigo-800",
                },
                {
                  label: "Total Payout",
                  value: `INR ${snapshot.totalPayout.toLocaleString()}`,
                  tone: "bg-emerald-100 text-emerald-800",
                },
                {
                  label: "Pending Employees",
                  value: snapshot.pendingPayrollEmployees,
                  tone: "bg-amber-100 text-amber-800",
                },
                {
                  label: "Hike Requests",
                  value: snapshot.hikeRequests,
                  tone: "bg-rose-100 text-rose-800",
                },
                {
                  label: "Leave Deduction (Month)",
                  value: `INR ${snapshot.leaveDeductionTotal.toLocaleString()}`,
                  tone: "bg-amber-100 text-amber-800",
                },
                {
                  label: "Employees Above 14 Days",
                  value: snapshot.employeesWithLeaveDeduction,
                  tone: "bg-orange-100 text-orange-800",
                },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {card.label}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-2xl font-semibold text-slate-900">{card.value}</div>
                    <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${card.tone}`}>
                      Live
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {actions.map((card) => (
              <Link
                key={card.title}
                href={card.href}
                className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                    <card.icon className="h-5 w-5" />
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                    {card.stat}
                  </span>
                </div>
                <div className="mt-4 text-lg font-semibold text-slate-900">{card.title}</div>
                <div className="mt-2 text-sm text-slate-600">{card.description}</div>
                <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {card.adminOnly ? "Admin subview" : "HR + Admin subview"}
                </div>
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                  Open
                  <ArrowRightIcon className="h-4 w-4" />
                </div>
              </Link>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Current Month Snapshot</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Recent payroll entries for the active payroll month.
                  </div>
                </div>
                <Link
                  href="/hr/payroll"
                  className="text-xs font-semibold text-slate-700 hover:text-slate-900"
                >
                  Open payroll run
                </Link>
              </div>
              <div className="mt-4 space-y-3">
                {recentPayrolls.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {row.userDisplayName || row.uid}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.userEmail || "No email"} | {row.status}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      INR {Number(row.netSalary || 0).toLocaleString()}
                    </div>
                  </div>
                ))}
                {!loading && recentPayrolls.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    No payroll records found for {selectedMonth}.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Access Model</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Keep /payroll as the primary entry while deep screens remain role-gated subviews.
                  </div>
                </div>
                <BuildingLibraryIcon className="h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {scopeLabel}
              </div>
              <div className="mt-3 space-y-3 text-sm text-slate-700">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                  HR payroll run remains on <span className="font-semibold">/hr/payroll</span>.
                </div>
                {adminOnly ? (
                  <>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                      Compensation editing and hike approvals remain on{" "}
                      <span className="font-semibold">/super-admin/payroll</span>.
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                      Vault-grade salary and bank visibility remains on{" "}
                      <span className="font-semibold">/admin/payroll/vault</span>.
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                    Admin-only payroll controls stay hidden outside the secure compensation and vault screens.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AuthGate>
  );
}
