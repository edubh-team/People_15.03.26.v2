"use client";

import { useEffect, useMemo, useState } from "react";
import { 
  CalendarDaysIcon, 
  CheckCircleIcon, 
  ClockIcon, 
  MapPinIcon, 
  BriefcaseIcon,
  ChartBarIcon,
  ArrowRightOnRectangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon
} from "@heroicons/react/24/outline";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import type { AttendanceDayDoc, LeaveRequestDoc } from "@/lib/types/attendance";
import {
  useAttendanceMonth,
  useAttendanceYear,
  useHolidaysMonth,
  useLeaveBalance,
  useMyLeaveRequests,
  useMyPresence,
  useApprovedLeaves,
} from "@/lib/hooks/useAttendance";
import { useAttendanceActions } from "@/lib/hooks/useAttendanceActions";
import { getTodayKey } from "@/lib/firebase/attendance";
import LeaveApplicationModal from "@/components/attendance/LeaveApplicationModal";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dateKeyFromParts(year: number, monthIndex0: number, day: number) {
  return `${year}-${pad2(monthIndex0 + 1)}-${pad2(day)}`;
}

function parseDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map((x) => Number(x));
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

function formatDateKey(dateKey: string) {
  const date = parseDateKey(dateKey);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString();
}

function isWeekday(d: Date) {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function formatMaybeTimestamp(value: unknown) {
  if (!value) return null;
  if (typeof value === "object" && value !== null) {
    const maybe = value as { toDate?: () => Date; seconds?: number };
    if (typeof maybe.toDate === "function") {
      const d = maybe.toDate();
      if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (typeof maybe.seconds === "number") {
      const d = new Date(maybe.seconds * 1000);
      if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  return null;
}

function expandLeaveDateKeys(req: LeaveRequestDoc) {
  const start = parseDateKey(req.startDateKey);
  const end = parseDateKey(req.endDateKey);
  const keys: string[] = [];
  const d = new Date(start);
  while (d.getTime() <= end.getTime()) {
    keys.push(getTodayKey(d));
    d.setDate(d.getDate() + 1);
  }
  return keys;
}

function buildMonthGrid(year: number, monthIndex0: number) {
  const first = new Date(year, monthIndex0, 1);
  const start = new Date(first);
  const weekday = (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - weekday);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function computeWorkingDays(year: number, monthIndex0: number, holidayKeys: Set<string>) {
  const last = new Date(year, monthIndex0 + 1, 0);
  let total = 0;
  for (let day = 1; day <= last.getDate(); day += 1) {
    const d = new Date(year, monthIndex0, day);
    if (!isWeekday(d)) continue;
    const key = dateKeyFromParts(year, monthIndex0, day);
    if (holidayKeys.has(key)) continue;
    total += 1;
  }
  return total;
}

function getLeaveStatusLabel(status: string | undefined | null) {
  const normalized = (status ?? "").toLowerCase();
  switch (normalized) {
    case "pending_hr":
      return "Applied - HR Review";
    case "pending_manager":
      return "Applied - Manager Review";
    case "pending":
      return "Applied";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    default:
      return "Applied";
  }
}

function getLeaveStatusTone(status: string | undefined | null) {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "approved") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (normalized === "rejected") return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

export default function AttendancePage() {
  const { firebaseUser } = useAuth();
  const uid = firebaseUser?.uid ?? null;
  const now = new Date();
  const [monthIndex0, setMonthIndex0] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [clock, setClock] = useState(() => new Date());
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);

  const todayKey = useMemo(() => getTodayKey(), []);

  const presenceQuery = useMyPresence(uid);
  const monthAttendance = useAttendanceMonth(uid, year, monthIndex0);
  const yearAttendance = useAttendanceYear(uid, year);
  const holidaysQuery = useHolidaysMonth(year, monthIndex0);
  const approvedLeavesQuery = useApprovedLeaves(uid);
  const myLeaveRequestsQuery = useMyLeaveRequests(uid);
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

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [setClock]);
  
  const holidayMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holidaysQuery.data ?? []) m.set(h.dateKey, h.name);
    return m;
  }, [holidaysQuery.data]);

  const holidayKeys = useMemo(() => new Set(holidayMap.keys()), [holidayMap]);

  const leaveKeys = useMemo(() => {
    const set = new Set<string>();
    for (const req of approvedLeavesQuery.data ?? []) {
      for (const k of expandLeaveDateKeys(req)) set.add(k);
    }
    return set;
  }, [approvedLeavesQuery.data]);

  const attendanceByKey = useMemo(() => {
    const m = new Map<string, AttendanceDayDoc>();
    for (const d of monthAttendance.data ?? []) m.set(d.dateKey, d);
    return m;
  }, [monthAttendance.data]);

  const workingDays = useMemo(
    () => computeWorkingDays(year, monthIndex0, holidayKeys),
    [holidayKeys, monthIndex0, year],
  );

  const presentDays = useMemo(() => {
    let count = 0;
    for (const d of monthAttendance.data ?? []) {
      if (d.status === "on_leave") continue;
      if (d.dayStatus === "on_leave") continue;
      if (d.status === "checked_in" || d.status === "checked_out") count += 1;
    }
    return count;
  }, [monthAttendance.data]);

  const attendancePercent = workingDays > 0 ? Math.round((presentDays / workingDays) * 100) : 0;

  const ytdWorkedDays = useMemo(() => {
    let count = 0;
    for (const d of yearAttendance.data ?? []) {
      if (d.status === "checked_in" || d.status === "checked_out") count += 1;
    }
    return count;
  }, [yearAttendance.data]);

  const ytdProgress = Math.min(100, Math.round((ytdWorkedDays / 260) * 100));

  const monthGrid = useMemo(() => buildMonthGrid(year, monthIndex0), [monthIndex0, year]);
  const myLeaveRequests = useMemo(
    () => (myLeaveRequestsQuery.data ?? []).slice(0, 8),
    [myLeaveRequestsQuery.data],
  );
  const monthLabel = useMemo(
    () => new Date(year, monthIndex0, 1).toLocaleString(undefined, { month: "long", year: "numeric" }),
    [monthIndex0, year],
  );

  return (
    <AuthGate>
      <div className="min-h-screen bg-slate-50/50 pb-12 pt-8 font-sans">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                Attendance & Time
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Manage your daily check-ins, view history, and track performance.
              </p>
            </div>
            <div className="flex items-center gap-3">
               <div className="text-right hidden sm:block">
                  <div className="text-sm font-medium text-slate-900">
                    {clock.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  </div>
                  <div className="text-xs text-slate-500">Current Server Time</div>
               </div>
               <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-900/5">
                  <ClockIcon className="h-6 w-6 text-indigo-600" />
               </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Working Days Card */}
            <div className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5 transition-all hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">Working Days</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{workingDays}</p>
                </div>
                <div className="rounded-xl bg-indigo-50 p-3 text-indigo-600">
                  <CalendarDaysIcon className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-xs text-slate-400">
                <span className="font-medium text-indigo-600">{monthLabel}</span>
                <span className="mx-1">&middot;</span>
                <span>Scheduled</span>
              </div>
            </div>

            {/* Attendance Rate Card */}
            <div className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5 transition-all hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">Attendance</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{attendancePercent}%</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
                  <CheckCircleIcon className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-xs text-slate-400">
                <span className="font-medium text-emerald-600">{presentDays} days</span>
                <span className="mx-1">&middot;</span>
                <span>Present this month</span>
              </div>
            </div>

            {/* Leave Balance Card */}
            <div className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5 transition-all hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">PTO Balance</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
                    {leaveBalanceQuery.data ? leaveBalanceQuery.data.ptoRemaining : "—"}
                  </p>
                </div>
                <div className="rounded-xl bg-amber-50 p-3 text-amber-600">
                  <BriefcaseIcon className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-xs text-slate-400">
                <span className="font-medium text-amber-600">Available</span>
                <span className="mx-1">&middot;</span>
                <span>For use</span>
              </div>
            </div>

            {/* Yearly Progress Card */}
            <div className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5 transition-all hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">Yearly Goal</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{ytdWorkedDays}</p>
                </div>
                <div className="relative h-12 w-12">
                  <svg viewBox="0 0 36 36" className="h-12 w-12 rotate-[-90deg]">
                    <path
                      d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="#f1f5f9"
                      strokeWidth="3"
                    />
                    <path
                      d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="3"
                      strokeDasharray={`${ytdProgress}, 100`}
                      className="transition-all duration-1000 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-700">
                    {ytdProgress}%
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center text-xs text-slate-400">
                <span className="font-medium text-blue-600">260 days</span>
                <span className="mx-1">&middot;</span>
                <span>Target</span>
              </div>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-12">
            {/* Left Column: Action Center */}
            <div className="lg:col-span-4 space-y-6">
              <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
                <div className="mb-8 flex flex-col items-center justify-center pt-2">
                  <div className="text-center">
                    <h3 className="text-sm font-medium uppercase tracking-wider text-slate-500">Current Time</h3>
                    <div className="mt-2 text-5xl font-black tracking-tight text-slate-900 tabular-nums">
                      {clock.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="mt-2 flex items-center justify-center gap-2">
                      <div className={`relative flex h-2.5 w-2.5 items-center justify-center`}>
                         {geoStatus === "locating" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75"></span>}
                         <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${geoStatus === "ok" ? "bg-emerald-500" : geoStatus === "denied" ? "bg-rose-500" : "bg-indigo-400"}`}></span>
                      </div>
                      <span className="text-xs font-medium text-slate-500">
                        {geoStatus === "ok" ? "Location Verified" : geoStatus === "locating" ? "Locating..." : geoStatus === "denied" ? "Location Denied" : "Ready"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Main Action Buttons */}
                <div className="grid gap-4">
                  <button
                    type="button"
                    disabled={!uid || isBusy || geoStatus === "denied"}
                    onClick={handlePrimaryAction}
                    className={`group relative flex h-20 w-full items-center justify-center gap-3 rounded-2xl text-lg font-bold shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70 ${
                      todayPresence?.status === "checked_in" || todayPresence?.status === "on_break"
                        ? "bg-white ring-1 ring-inset ring-slate-200 text-slate-700 hover:bg-slate-50 hover:shadow-slate-200"
                        : "bg-indigo-600 text-white shadow-indigo-200 hover:bg-indigo-500 hover:shadow-indigo-300"
                    }`}
                  >
                    {todayPresence?.status === "checked_in" || todayPresence?.status === "on_break" ? (
                      <>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 transition-colors group-hover:bg-slate-200">
                           <ArrowRightOnRectangleIcon className="h-5 w-5 text-slate-500 group-hover:text-slate-700" />
                        </div>
                        Check out
                      </>
                    ) : (
                      <>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/20 text-white transition-colors group-hover:bg-indigo-500/30">
                           <MapPinIcon className="h-5 w-5" />
                        </div>
                        Check in
                      </>
                    )}
                  </button>

                  {(todayPresence?.status === "checked_in" || todayPresence?.status === "on_break") && (
                    <button
                      type="button"
                      disabled={!uid || isBusy}
                      onClick={handleBreakAction}
                      className={`flex h-14 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 disabled:opacity-70 ${
                        todayPresence?.status === "on_break"
                          ? "bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-200"
                          : "bg-amber-50 text-amber-700 hover:bg-amber-100 ring-1 ring-inset ring-amber-600/20"
                      }`}
                    >
                      {todayPresence?.status === "on_break" ? "Resume Work" : "Take a Break"}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={!uid || isBusy}
                    onClick={() => setIsLeaveModalOpen(true)}
                    className="flex h-12 w-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-all"
                  >
                    Apply for leave
                  </button>
                </div>

                <LeaveApplicationModal
                  isOpen={isLeaveModalOpen}
                  onClose={() => setIsLeaveModalOpen(false)}
                />

                {/* Status List */}
                <div className="mt-8 rounded-xl bg-slate-50 p-4 space-y-3 border border-slate-100">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Current Status</span>
                    <span className={`font-semibold capitalize px-2 py-0.5 rounded-full text-xs ${
                        !todayPresence ? "bg-slate-200 text-slate-600" :
                        todayPresence.status === "checked_in" ? "bg-emerald-100 text-emerald-700" :
                        todayPresence.status === "on_break" ? "bg-amber-100 text-amber-700" :
                        todayPresence.status === "checked_out" ? "bg-slate-200 text-slate-700" :
                        "bg-rose-100 text-rose-700"
                    }`}>
                      {todayPresence?.dayStatus?.replace("_", " ") || todayPresence?.status?.replace("_", " ") || "Not checked in"}
                    </span>
                  </div>
                  <div className="h-px bg-slate-200" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Punch In</span>
                    <span className="font-mono font-medium text-slate-700">
                      {formatMaybeTimestamp(todayPresence?.checkedInAt) ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Punch Out</span>
                    <span className="font-mono font-medium text-slate-700">
                      {formatMaybeTimestamp(todayPresence?.checkedOutAt) ?? "—"}
                    </span>
                  </div>
                </div>

                <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-900">My Leave Requests</div>
                    <div className="text-xs text-slate-500">Latest {myLeaveRequests.length}</div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {myLeaveRequestsQuery.isLoading ? (
                      <div className="text-xs text-slate-500">Loading requests...</div>
                    ) : myLeaveRequests.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
                        No leave applications yet.
                      </div>
                    ) : (
                      myLeaveRequests.map((request, index) => (
                        <div key={`${request.startDateKey}-${request.endDateKey}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-medium text-slate-700">
                              {formatDateKey(request.startDateKey)} - {formatDateKey(request.endDateKey)}
                            </div>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getLeaveStatusTone(request.status)}`}>
                              {getLeaveStatusLabel(request.status)}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Type: {request.type} | Chargeable days: {request.chargeableDays ?? "-"}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {presenceQuery.error && (
                  <div className="mt-4 rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/10">
                    {presenceQuery.error instanceof Error ? presenceQuery.error.message : "Error"}
                  </div>
                )}
                
                {toast && (
                  <div className="mt-4 rounded-lg bg-slate-800 px-4 py-3 text-center text-sm font-medium text-white shadow-lg animate-in fade-in slide-in-from-bottom-2">
                    {toast}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Calendar */}
            <div className="lg:col-span-8">
              <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
                {/* Calendar Header */}
                <div className="flex items-center justify-between border-b border-slate-100 p-6">
                  <div>
                    <h3 className="text-base font-semibold leading-6 text-slate-900">Attendance History</h3>
                    <p className="mt-1 text-sm text-slate-500">{monthLabel}</p>
                  </div>
                  <div className="flex items-center rounded-lg bg-slate-50 p-1 ring-1 ring-slate-900/5">
                    <button
                      onClick={() => {
                        const next = new Date(year, monthIndex0 - 1, 1);
                        setYear(next.getFullYear());
                        setMonthIndex0(next.getMonth());
                      }}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-slate-600 hover:shadow-sm transition-all"
                    >
                      <span className="sr-only">Previous month</span>
                      <ChevronLeftIcon className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => {
                        const d = new Date();
                        setYear(d.getFullYear());
                        setMonthIndex0(d.getMonth());
                      }}
                      className="px-4 py-1.5 text-xs font-semibold text-slate-700 hover:text-indigo-600 transition-colors"
                    >
                      Today
                    </button>
                    <button
                      onClick={() => {
                        const next = new Date(year, monthIndex0 + 1, 1);
                        setYear(next.getFullYear());
                        setMonthIndex0(next.getMonth());
                      }}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-slate-600 hover:shadow-sm transition-all"
                    >
                      <span className="sr-only">Next month</span>
                      <ChevronRightIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* Desktop Calendar Grid */}
                <div className="hidden sm:block p-6">
                  <div className="grid grid-cols-7 gap-px rounded-lg bg-slate-200 border border-slate-200 overflow-hidden ring-1 ring-slate-200">
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                      <div key={d} className="bg-slate-50 py-2 text-center text-xs font-semibold text-slate-500">
                        {d}
                      </div>
                    ))}
                    {monthGrid.map((d) => {
                      const key = getTodayKey(d);
                      const inMonth = d.getMonth() === monthIndex0;
                      const isToday = key === todayKey;
                      const holidayName = holidayMap.get(key) ?? null;
                      const isHoliday = Boolean(holidayName);
                      const isLeave = leaveKeys.has(key);
                      const day = attendanceByKey.get(key) ?? null;
                      const isLate = day?.dayStatus === "late";
                      const isPresent = Boolean(day && (day.status === "checked_in" || day.status === "checked_out"));
                      const showAbsent =
                        inMonth &&
                        isWeekday(d) &&
                        !isHoliday &&
                        !isLeave &&
                        !isPresent &&
                        d.getTime() <= new Date().getTime();

                      return (
                        <div
                          key={key}
                          className={`group relative min-h-[100px] p-2 transition-colors hover:bg-slate-50 ${
                            inMonth ? "bg-white" : "bg-slate-50/50 text-slate-400"
                          } ${isToday ? "bg-indigo-50/30" : ""}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                                isToday ? "bg-indigo-600 text-white" : "text-slate-700"
                            }`}>
                              {d.getDate()}
                            </span>
                          </div>

                          <div className="mt-2 space-y-1">
                            {isHoliday && (
                              <div className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600" title={holidayName ?? ""}>
                                {holidayName}
                              </div>
                            )}
                            {isLeave && (
                              <div className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 border border-indigo-100">
                                PTO
                              </div>
                            )}
                            {isLate && (
                              <div className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-100">
                                Late
                              </div>
                            )}
                            {isPresent && (
                              <div className="flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 border border-emerald-100">
                                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                <span className="text-[10px] font-medium text-emerald-700">
                                    {formatMaybeTimestamp(day?.checkedInAt) ?? "Present"}
                                </span>
                              </div>
                            )}
                            {showAbsent && (
                              <div className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 border border-rose-100">
                                Absent
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Legend */}
                  <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                      <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full bg-emerald-500" />
                          <span>Present</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full bg-amber-500" />
                          <span>Late</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full bg-rose-500" />
                          <span>Absent</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full bg-indigo-500" />
                          <span>PTO/Leave</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full bg-slate-400" />
                          <span>Holiday</span>
                      </div>
                  </div>
                </div>

                {/* Mobile List View */}
                <div className="sm:hidden p-4 space-y-3">
                  {new Array(new Date(year, monthIndex0 + 1, 0).getDate())
                    .fill(null)
                    .map((_, idx) => idx + 1)
                    .map((day) => {
                      const key = dateKeyFromParts(year, monthIndex0, day);
                      const d = new Date(year, monthIndex0, day);
                      const holidayName = holidayMap.get(key) ?? null;
                      const isHoliday = Boolean(holidayName);
                      const isLeave = leaveKeys.has(key);
                      const rec = attendanceByKey.get(key) ?? null;
                      const isLate = rec?.dayStatus === "late";
                      const isPresent = Boolean(rec && (rec.status === "checked_in" || rec.status === "checked_out"));
                      const isAbsent =
                        isWeekday(d) &&
                        !isHoliday &&
                        !isLeave &&
                        !isPresent &&
                        d.getTime() <= new Date().getTime();

                      if (!isPresent && !isHoliday && !isLeave && !isAbsent && !isLate) return null;

                      const statusText = isHoliday
                        ? holidayName
                        : isLeave
                          ? "PTO"
                          : isLate
                            ? "Late"
                            : isPresent
                              ? "Present"
                              : isAbsent
                                ? "Absent"
                                : "—";

                      return (
                        <div key={key} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
                          <div className="flex items-center gap-3">
                             <div className="flex flex-col items-center justify-center rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-100">
                               <span className="text-sm font-bold text-slate-900">{day}</span>
                               <span className="text-[10px] uppercase tracking-wide text-slate-500">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
                             </div>
                             <div>
                               <div className="text-sm font-medium text-slate-900">{statusText}</div>
                               {isPresent && (
                                 <div className="text-xs text-slate-500 font-mono mt-0.5">
                                    In: {formatMaybeTimestamp(rec?.checkedInAt)}
                                 </div>
                               )}
                             </div>
                          </div>
                          <div className={`h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                             isHoliday ? "bg-slate-400" : 
                             isLeave ? "bg-indigo-500" : 
                             isLate ? "bg-amber-500" : 
                             isPresent ? "bg-emerald-500" : 
                             isAbsent ? "bg-rose-500" : "bg-slate-200"
                          }`} />
                        </div>
                      );
                    })}
                </div>

                {monthAttendance.error && (
                  <div className="p-4 text-center text-sm text-rose-500">
                    Failed to load attendance data. Please try refreshing.
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
