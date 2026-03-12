"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getHomeRoute } from "@/lib/utils/routing";
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import DirectSaleForm from "@/components/leads/DirectSaleForm";
import {
  useLeaveBalance,
  useMyAttendanceDays,
  useMyPresence,
} from "@/lib/hooks/useAttendance";
import { useAttendanceActions } from "@/lib/hooks/useAttendanceActions";
import { getTodayKey } from "@/lib/firebase/attendance";
import { calculateActiveMinutes } from "@/lib/attendance-utils";
import { db, isFirebaseReady } from "@/lib/firebase/client";
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import type { FirestoreError } from "firebase/firestore";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { getLeadStatusVariants } from "@/lib/leads/status";
import { canPunchNewSale } from "@/lib/access";
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

function toDateSafe(x: unknown): Date {
  if (x instanceof Date) return x;
  const maybe = x as { toDate?: () => Date };
  if (typeof maybe?.toDate === "function") return maybe.toDate();
  if (typeof x === "number" || typeof x === "string") return new Date(x);
  return new Date(NaN);
}

function formatHours(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export default function DashboardIndexPage() {
  const { firebaseUser, userDoc } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (userDoc) {
      const home = getHomeRoute(userDoc.role, userDoc.orgRole);
      if (home !== "/dashboard") {
        router.replace(home);
      }
    }
  }, [userDoc, router]);

  const uid = firebaseUser?.uid ?? null;
  const todayKey = useMemo(() => getTodayKey(), []);

  const presenceQuery = useMyPresence(uid);
  const recentDaysQuery = useMyAttendanceDays(uid, 7);
  const leaveBalanceQuery = useLeaveBalance(uid);

  const todayPresence = useMemo(() => {
    const p = presenceQuery.data;
    if (!p) return null;
    if (p.dateKey !== todayKey) return null;
    return p;
  }, [presenceQuery.data, todayKey]);

  const {
    handlePrimaryAction,
    handleBreakAction,
    isBusy,
    toast,
    geoStatus,
    lastLocation,
  } = useAttendanceActions(uid, todayPresence);

  const todayLoginMinutes = calculateActiveMinutes(todayPresence);

  const dailyTargetLeads = 20;
  
  const [showDirectSaleModal, setShowDirectSaleModal] = useState(false);
  const [leadsTodayRealtime, setLeadsTodayRealtime] = useState(0);
  useEffect(() => {
    if (!db || !uid || !isFirebaseReady) return;
    const q = query(
      collection(db, "leads"),
      where("ownerUid", "==", uid),
      where("createdDateKey", "==", todayKey),
      limit(500),
    );
    return onSnapshot(q, (snap) => setLeadsTodayRealtime(snap.size), (error: FirestoreError) => {
      if (error?.code === "permission-denied") return;
      console.error("Dashboard leadsTodayRealtime listener error", error);
    });
  }, [uid, todayKey]);

  const leadsContactedTodayQuery = useQuery({
    queryKey: ["leadsContactedToday", uid, todayKey],
    enabled: Boolean(uid && isFirebaseReady),
    queryFn: async () => {
      if (!db || !uid) return 0;
      const q = query(
        collection(db!, "leads"),
        where("ownerUid", "==", uid),
        where("lastContactDateKey", "==", todayKey),
        limit(500),
      );
      const snap = await getDocs(q);
      return snap.size;
    },
  });

  const leadsStatusCountsQuery = useQuery({
    queryKey: ["leadsStatusCounts", uid],
    enabled: Boolean(uid && isFirebaseReady),
    queryFn: async () => {
      if (!db || !uid) return { hot: 0, followup: 0, cold: 0, closed: 0 };
      const statuses = [
        { key: "hot", values: getLeadStatusVariants("interested") },
        { key: "followup", values: getLeadStatusVariants("ringing", "followup") },
        { key: "cold", values: getLeadStatusVariants("not_interested", "wrong_number") },
        { key: "closed", values: getLeadStatusVariants("closed", "converted", "paymentfollowup") },
      ] as const;
      const results: Record<string, number> = {};
      await Promise.all(
        statuses.map(async (statusGroup) => {
          const snaps = await Promise.all(
            statusGroup.values.map((status) =>
              getDocs(
                query(
                  collection(db!, "leads"),
                  where("ownerUid", "==", uid),
                  where("status", "==", status),
                  limit(500),
                ),
              ),
            ),
          );
          results[statusGroup.key] = snaps.reduce((sum, snap) => sum + snap.size, 0);
        }),
      );
      return {
        hot: results.hot ?? 0,
        followup: results.followup ?? 0,
        cold: results.cold ?? 0,
        closed: results.closed ?? 0,
      };
    },
  });

  const followUpsDueTodayQuery = useQuery({
    queryKey: ["followUpsDueToday", uid, todayKey],
    enabled: Boolean(uid && isFirebaseReady),
    queryFn: async () => {
      if (!db || !uid) return 0;
      const q = query(
        collection(db!, "leads"),
        where("ownerUid", "==", uid),
        where("nextFollowUpDateKey", "==", todayKey),
        limit(500),
      );
      const snap = await getDocs(q);
      return snap.size;
    },
  });

  const taskCountsQuery = useQuery({
    queryKey: ["taskCounts", uid],
    enabled: Boolean(uid && isFirebaseReady),
    queryFn: async () => {
      if (!db || !uid) return { todo: 0, inProgress: 0, done: 0, blocked: 0 };
      const statuses = [
        { key: "todo", value: "todo" },
        { key: "inProgress", value: "in_progress" },
        { key: "done", value: "done" },
        { key: "blocked", value: "blocked" },
      ] as const;
      const results: Record<string, number> = {};
      await Promise.all(
        statuses.map(async (s) => {
          const [assignedToSnap, legacyAssignedSnap] = await Promise.all([
            getDocs(
              query(
                collection(db!, "tasks"),
                where("assignedTo", "==", uid),
                where("status", "==", s.value),
                limit(500),
              ),
            ),
            getDocs(
              query(
                collection(db!, "tasks"),
                where("assigneeUid", "==", uid),
                where("status", "==", s.value),
                limit(500),
              ),
            ),
          ]);
          results[s.key] = new Set(
            [...assignedToSnap.docs, ...legacyAssignedSnap.docs].map((doc) => doc.id),
          ).size;
        }),
      );
      return {
        todo: results.todo ?? 0,
        inProgress: results.inProgress ?? 0,
        done: results.done ?? 0,
        blocked: results.blocked ?? 0,
      };
    },
  });

  const last7 = useMemo(() => {
    const days: string[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      days.push(`${yyyy}-${mm}-${dd}`);
    }
    return days;
  }, []);

  const leadsFunnelQuery = useQuery({
    queryKey: ["leadsFunnel7Days", uid],
    enabled: Boolean(uid && isFirebaseReady),
    queryFn: async () => {
      if (!db || !uid) return [];
      const results: Array<{ dateKey: string; newLeads: number; contacted: number }> = [];
      for (const k of last7) {
        const [newSnap, contactedSnap] = await Promise.all([
          getDocs(
            query(
              collection(db!, "leads"),
              where("ownerUid", "==", uid),
              where("createdDateKey", "==", k),
              limit(500),
            ),
          ),
          getDocs(
            query(
              collection(db!, "leads"),
              where("ownerUid", "==", uid),
              where("lastContactDateKey", "==", k),
              limit(500),
            ),
          ),
        ]);
        results.push({
          dateKey: k.slice(5),
          newLeads: newSnap.size,
          contacted: contactedSnap.size,
        });
      }
      return results;
    },
  });

  const taskCompletionPercent = (() => {
    const t = taskCountsQuery.data;
    if (!t) return 0;
    const total = t.todo + t.inProgress + t.done + t.blocked;
    if (total === 0) return 0;
    return Math.round((t.done / total) * 100);
  })();

  const leadsContacted = leadsContactedTodayQuery.data ?? 0;
  const leadsProgress = Math.min(100, Math.round(((leadsContacted + leadsTodayRealtime) / dailyTargetLeads) * 100));

  const punches = useMemo(() => {
    const events: Array<{ label: string; at: Date }> = [];
    const days = recentDaysQuery.data ?? [];
    for (const d of days) {
      if (d.checkedInAt) events.push({ label: "Checked in", at: toDateSafe(d.checkedInAt) });
      if (d.checkedOutAt) events.push({ label: "Checked out", at: toDateSafe(d.checkedOutAt) });
    }
    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    return events.slice(0, 3);
  }, [recentDaysQuery.data]);

  const hrGoalMinutes = 480;
  const hrProgress = Math.min(100, Math.round((todayLoginMinutes / hrGoalMinutes) * 100));

  return (
    <AuthGate>
      <div className="min-h-screen bg-[#F5F5F7] text-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500">
            <span className="h-2 w-2 rounded-full bg-indigo-600" />
            Home
          </div>
          <div className="flex items-center justify-between mt-2">
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            {canPunchNewSale(userDoc) && (
              <button
                onClick={() => setShowDirectSaleModal(true)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
              >
                Punch New Sale
              </button>
            )}
          </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="rounded-[24px] border border-slate-200/50 bg-white/70 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold tracking-tight">Attendance today</div>
                <div className="mt-1 text-xs text-slate-500">{todayKey}</div>
                <div className="mt-1 text-xs text-slate-500">
                  GPS:{" "}
                  {geoStatus === "ok"
                    ? "Locked"
                    : geoStatus === "locating"
                      ? "Locating…"
                      : geoStatus === "denied"
                        ? "Denied"
                        : geoStatus === "unsupported"
                          ? "Unsupported"
                          : "Ready"}
                </div>
              </div>
              <div
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  todayPresence?.status === "checked_in"
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : todayPresence?.status === "on_break"
                      ? "bg-amber-50 text-amber-900 border-amber-200"
                      : todayPresence?.status === "checked_out"
                        ? "bg-slate-50 text-slate-800 border-slate-200"
                        : todayPresence?.status === "on_leave"
                          ? "bg-amber-50 text-amber-900 border-amber-200"
                          : "bg-slate-50 text-slate-800 border-slate-200"
                }`}
              >
                {todayPresence?.status
                  ? todayPresence.status === "checked_in"
                    ? "Checked in"
                    : todayPresence.status === "on_break"
                      ? "On break"
                      : todayPresence.status === "checked_out"
                        ? "Checked out"
                        : "On leave"
                  : "Not checked in"}
              </div>
            </div>
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              <div>
                <div className="text-xs font-medium text-slate-600">Login hours</div>
                <div className="mt-1 text-lg font-semibold tracking-tight">
                  {formatHours(todayLoginMinutes)}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-600">Recent days</div>
                <div className="mt-1 text-lg font-semibold tracking-tight">
                  {(recentDaysQuery.data ?? []).length}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-600">PTO remaining</div>
                <div className="mt-1 text-lg font-semibold tracking-tight">
                  {leaveBalanceQuery.data ? leaveBalanceQuery.data.ptoRemaining : "—"}
                </div>
              </div>
            </div>
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-slate-600">Workday ring</div>
                <div className="mt-2 relative h-28 w-28">
                  <svg viewBox="0 0 100 100" className="h-28 w-28">
                    <circle cx="50" cy="50" r="42" stroke="#E5E7EB" strokeWidth="12" fill="none" />
                    <motion.circle
                      cx="50"
                      cy="50"
                      r="42"
                      stroke="rgb(16, 185, 129)"
                      strokeWidth="12"
                      strokeLinecap="round"
                      fill="none"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: hrProgress / 100 }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold">
                    {hrProgress}%
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-600">Session progress</div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <motion.div
                    className="h-full rounded-full bg-indigo-600"
                    initial={{ width: 0 }}
                    animate={{ width: `${hrProgress}%` }}
                    transition={{ type: "spring", stiffness: 260, damping: 24 }}
                  />
                </div>
                <div className="mt-2 text-xs text-slate-600">
                  Current Session: {formatHours(todayLoginMinutes)}
                </div>
                <div className="mt-2 text-xs text-slate-600">
                  Location:{" "}
                  {lastLocation
                    ? `${lastLocation.lat.toFixed(4)}, ${lastLocation.lng.toFixed(4)}`
                    : "—"}
                </div>
              </div>
            </div>
            <div className="mt-6">
              <div className="text-xs font-medium text-slate-600">Last punches</div>
              <div className="mt-2 space-y-2">
                {punches.length === 0 ? (
                  <div className="text-xs text-slate-500">No punches yet.</div>
                ) : (
                  punches.map((e, i) => (
                    <div key={`${e.label}-${i}`} className="flex items-center gap-3 text-xs">
                      <div className="h-2 w-2 rounded-full bg-slate-300" />
                      <div className="font-medium">{e.label}</div>
                      <div className="text-slate-500">{e.at.toLocaleString()}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="mt-6 space-y-3">
              {toast && (
                <div className="rounded-lg bg-slate-800 px-4 py-2 text-center text-xs text-white shadow-lg">
                  {toast}
                </div>
              )}
              <div className="grid gap-3">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handlePrimaryAction}
                  className={`inline-flex h-12 w-full items-center justify-center rounded-[18px] px-5 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 ${
                    todayPresence?.status === "checked_in" || todayPresence?.status === "on_break"
                      ? "bg-slate-900 text-white hover:bg-slate-800"
                      : "bg-indigo-600 text-white hover:bg-indigo-500"
                  }`}
                >
                  {isBusy
                    ? "Please wait..."
                    : todayPresence?.status === "checked_in" || todayPresence?.status === "on_break"
                      ? "Check out"
                      : "Check in"}
                </button>
                
                {(todayPresence?.status === "checked_in" || todayPresence?.status === "on_break") && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={handleBreakAction}
                    className="inline-flex h-12 w-full items-center justify-center rounded-[18px] border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
                  >
                    {todayPresence.status === "on_break" ? "Resume Work" : "Take a Break"}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200/50 bg-white/70 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold tracking-tight">Daily leads target</div>
                <div className="mt-1 text-xs text-slate-500">Owner: {userDoc?.displayName ?? "—"}</div>
              </div>
              <div className="text-2xl font-semibold tracking-tight">{dailyTargetLeads}</div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <div>Contacted today</div>
                <motion.div
                  className="font-semibold text-slate-900"
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                >
                  {leadsContacted + leadsTodayRealtime}
                </motion.div>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-[width]"
                  style={{ width: `${leadsProgress}%` }}
                />
              </div>
            </div>
            <div className="mt-6 h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={leadsFunnelQuery.data ?? []}>
                  <defs>
                    <linearGradient id="indigoFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="dateKey" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="newLeads" stroke="#6366F1" fill="url(#indigoFill)" />
                  <Area type="monotone" dataKey="contacted" stroke="#16A34A" fillOpacity={0.15} fill="#16A34A" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200/50 bg-white/70 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
            <div className="text-sm font-semibold tracking-tight">Follow-ups due today</div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
              {followUpsDueTodayQuery.data ?? 0}
            </div>
            <div className="mt-1 text-xs text-slate-500">Leads requiring action</div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="rounded-[24px] border border-slate-200/50 bg-white/70 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
            <div className="text-sm font-semibold tracking-tight">Lead status</div>
            <div className="mt-4 h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: "Hot", value: leadsStatusCountsQuery.data?.hot ?? 0, color: "#EF4444" },
                      { name: "Follow-up", value: leadsStatusCountsQuery.data?.followup ?? 0, color: "#F59E0B" },
                      { name: "Cold", value: leadsStatusCountsQuery.data?.cold ?? 0, color: "#60A5FA" },
                      { name: "Closed", value: leadsStatusCountsQuery.data?.closed ?? 0, color: "#10B981" },
                    ]}
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    <Cell fill="#EF4444" />
                    <Cell fill="#F59E0B" />
                    <Cell fill="#60A5FA" />
                    <Cell fill="#10B981" />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-xs text-slate-600">Pipeline health</div>
          </div>

          <div className="rounded-[24px] border border-slate-200/50 bg-white/70 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
            <div className="text-sm font-semibold tracking-tight">Task completion</div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
              {taskCompletionPercent}%
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-600 transition-[width]"
                style={{ width: `${taskCompletionPercent}%` }}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="text-slate-600">Todo</div>
                <div className="mt-1 font-semibold">
                  {taskCountsQuery.data?.todo ?? 0}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-indigo-50 p-3 text-xs">
                <div className="text-indigo-700">In progress</div>
                <div className="mt-1 font-semibold text-indigo-900">
                  {taskCountsQuery.data?.inProgress ?? 0}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-emerald-50 p-3 text-xs">
                <div className="text-emerald-700">Done</div>
                <div className="mt-1 font-semibold text-emerald-900">
                  {taskCountsQuery.data?.done ?? 0}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-amber-50 p-3 text-xs">
                <div className="text-amber-800">Blocked</div>
                <div className="mt-1 font-semibold text-amber-900">
                  {taskCountsQuery.data?.blocked ?? 0}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200/50 bg-white/70 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
            <div className="text-sm font-semibold tracking-tight">Shortcuts</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Link href="/attendance" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm hover:bg-slate-100">
                Attendance
              </Link>
              <Link href="/crm/leads" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm hover:bg-slate-100">
                CRM Leads
              </Link>
              <Link href="/tasks" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm hover:bg-slate-100">
                Tasks
              </Link>
              <Link href="/reports" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm hover:bg-slate-100">
                Reports
              </Link>
            </div>
          </div>
        </div>
      </div>
      </div>
      
      {/* Direct Sale Modal */}
      <Transition show={showDirectSaleModal} as={Fragment}>
        <Dialog onClose={() => setShowDirectSaleModal(false)} className="relative z-50">
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
                  <p className="text-xs text-slate-500 mt-1">
                    Manually enter a sale for a walk-in or direct lead.
                  </p>
                </div>
                
                <div className="max-h-[80vh] overflow-y-auto p-6">
                  <DirectSaleForm
                    onSuccess={() => {
                      setShowDirectSaleModal(false);
                    }}
                    onCancel={() => setShowDirectSaleModal(false)}
                  />
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
    </AuthGate>
  );
}
