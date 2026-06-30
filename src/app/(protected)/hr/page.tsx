"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowRightIcon,
  BanknotesIcon,
  BriefcaseIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  UserGroupIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { isAdminUser, isHrUser } from "@/lib/access";
import { usePeopleDirectoryData } from "@/lib/people/directory";
import { useHrLeaveAuthority } from "@/lib/people/ops";
import { usePeoplePayrollSnapshot } from "@/lib/people/payroll-workspace";
import type { UserDoc } from "@/lib/types/user";

export default function PeopleOpsPage() {
  const { userDoc } = useAuth();
  const { snapshot, loading: snapshotLoading } = usePeoplePayrollSnapshot(userDoc);
  const {
    visibleUsers,
    loading: directoryLoading,
  } = usePeopleDirectoryData({
    includeExecutiveControl: false,
    sortMode: "display_name",
  });
  const {
    rows: pendingLeaveRows,
    counts: leaveCounts,
    loading: leaveLoading,
  } = useHrLeaveAuthority(userDoc, "pending");

  const recentEmployees = useMemo(() => {
    const activeEmployees = visibleUsers.filter((user) => (user.status || "").toLowerCase() === "active");
    return activeEmployees
      .sort((left, right) => {
        const leftName = left.displayName || left.email || left.uid;
        const rightName = right.displayName || right.email || right.uid;
        return leftName.localeCompare(rightName);
      })
      .slice(0, 6);
  }, [visibleUsers]);

  const pendingLeavePreview = useMemo(() => pendingLeaveRows.slice(0, 5), [pendingLeaveRows]);
  const pendingLeavesQueue = leaveCounts.pending;
  const loading = snapshotLoading || directoryLoading || leaveLoading;
  const showPersonnel = isAdminUser(userDoc);

  const moduleCards = [
    {
      title: "Directory & Onboarding",
      description: "Active employees, onboarding, and employment actions.",
      href: "/hr/employees",
      icon: UsersIcon,
      stat: `${snapshot.activeEmployees} active`,
    },
    {
      title: "Attendance Oversight",
      description: "Daily attendance review and manual correction controls.",
      href: "/hr/attendance",
      icon: CalendarDaysIcon,
      stat: `${snapshot.onLeaveTodayTotal} on leave today`,
    },
    {
      title: "Leave Authority",
      description: "Review pending leave requests and clear the queue.",
      href: "/hr/leaves",
      icon: CheckCircleIcon,
      stat: `${pendingLeavesQueue} in queue`,
    },
    {
      title: "Recruitment",
      description: "Open candidate pipeline and handoff into employee creation.",
      href: "/hr/recruitment",
      icon: BriefcaseIcon,
      stat: `${snapshot.activeCandidates} active candidates`,
    },
    {
      title: "Payroll Ops",
      description: "Run payroll, review compensation, and open secure payroll tools.",
      href: "/payroll",
      icon: BanknotesIcon,
      stat: `${snapshot.payrollReadyEmployees} payroll-ready`,
    },
  ];

  return (
    <AuthGate allowIf={(user) => isHrUser(user) || isAdminUser(user)}>
      <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-8">
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                  People Ops
                </div>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                  Unified People Workspace
                </h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  Use this as the canonical HR entrypoint. Older HR and personnel pages stay available as deep tools until they are fully migrated here.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {loading ? "Refreshing people signals..." : `${snapshot.activeEmployees} active employees in view`}
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {[
                { label: "Active Employees", value: snapshot.activeEmployees, tone: "bg-slate-100 text-slate-800" },
                { label: "Pending Leaves (Org)", value: snapshot.pendingLeavesTotal, tone: "bg-amber-100 text-amber-800" },
                { label: "Active Candidates", value: snapshot.activeCandidates, tone: "bg-indigo-100 text-indigo-800" },
                { label: "Payroll Ready", value: snapshot.payrollReadyEmployees, tone: "bg-emerald-100 text-emerald-800" },
                { label: "On Leave Today (Org)", value: snapshot.onLeaveTodayTotal, tone: "bg-rose-100 text-rose-800" },
              ].map((card) => (
                <div key={card.label} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-3xl font-semibold text-slate-900">{card.value}</div>
                    <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${card.tone}`}>Live</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {moduleCards.map((card) => (
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
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                  Open
                  <ArrowRightIcon className="h-4 w-4" />
                </div>
              </Link>
            ))}

            {showPersonnel ? (
              <Link
                href="/super-admin/personnel"
                className="rounded-[24px] border border-indigo-200 bg-indigo-50/60 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-indigo-700 shadow-sm">
                    <UserGroupIcon className="h-5 w-5" />
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                    Super Admin
                  </span>
                </div>
                <div className="mt-4 text-lg font-semibold text-slate-900">Personnel & Hierarchy</div>
                <div className="mt-2 text-sm text-slate-600">
                  Sales hierarchy, temporary reporting, acting roles, and deeper personnel controls stay here until the full people merge is complete.
                </div>
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                  Open studio
                  <ArrowRightIcon className="h-4 w-4" />
                </div>
              </Link>
            ) : null}
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Directory Snapshot</div>
                  <div className="mt-1 text-xs text-slate-500">Quick scan of active employees before opening the full management screen.</div>
                </div>
                <Link href="/hr/employees" className="text-xs font-semibold text-slate-700 hover:text-slate-900">
                  Full directory
                </Link>
              </div>
              <div className="mt-4 space-y-3">
                {recentEmployees.map((employee: UserDoc) => (
                  <div key={employee.uid} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {employee.displayName ?? employee.email ?? employee.uid}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {employee.email ?? "No email"} | {employee.orgRole ?? employee.role}
                      </div>
                    </div>
                    <div className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      {(employee.status || "inactive").toLowerCase()}
                    </div>
                  </div>
                ))}
                {!loading && recentEmployees.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    No active employees found.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Leave Queue Snapshot</div>
                  <div className="mt-1 text-xs text-slate-500">Pending requests from the shared leave authority queue.</div>
                </div>
                <Link href="/hr/leaves" className="text-xs font-semibold text-slate-700 hover:text-slate-900">
                  Open leave authority
                </Link>
              </div>
              <div className="mt-4 space-y-3">
                {pendingLeavePreview.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <div className="text-sm font-semibold text-slate-900">{row.userName || row.uid || "Unknown employee"}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {row.startDateKey || "?"} to {row.endDateKey || "?"}
                    </div>
                    <div className="mt-2 text-xs text-slate-600">{row.reason || "No reason provided"}</div>
                  </div>
                ))}
                {!loading && pendingLeavePreview.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    No pending leave requests right now.
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AuthGate>
  );
}
