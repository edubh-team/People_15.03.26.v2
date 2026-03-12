"use client";

import { useMemo, useState } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { getTodayKey } from "@/lib/firebase/attendance";
import {
  useCheckIn,
  useCheckOut,
  useMarkOnLeave,
  useMyAttendanceDays,
  useMyPresence,
} from "@/lib/hooks/useAttendance";
import { RoleBadge } from "@/components/RoleBadge";

function formatMaybeTimestamp(value: unknown) {
  if (!value) return null;
  if (typeof value === "object" && value !== null) {
    const maybe = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toDate === "function") {
      const d = maybe.toDate();
      if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString();
    }
    if (typeof maybe.seconds === "number") {
      const d = new Date(maybe.seconds * 1000);
      if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString();
    }
  }
  return null;
}

export default function EmployeePage() {
  const { userDoc, firebaseUser } = useAuth();
  const uid = firebaseUser?.uid ?? null;
  const todayKey = useMemo(() => getTodayKey(), []);

  const presenceQuery = useMyPresence(uid);
  const daysQuery = useMyAttendanceDays(uid, 14);
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();
  const markOnLeave = useMarkOnLeave();

  const [actionError, setActionError] = useState<string | null>(null);

  const todayPresence = useMemo(() => {
    const p = presenceQuery.data;
    if (!p) return null;
    if (p.dateKey !== todayKey) return null;
    return p;
  }, [presenceQuery.data, todayKey]);

  const statusLabel = todayPresence?.status
    ? todayPresence.status === "checked_in"
      ? "Checked in"
      : todayPresence.status === "checked_out"
        ? "Checked out"
        : "On leave"
    : "Not checked in";

  const statusTone = todayPresence?.status
    ? todayPresence.status === "checked_in"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : todayPresence.status === "checked_out"
        ? "bg-slate-50 text-slate-800 border-slate-200"
        : "bg-amber-50 text-amber-900 border-amber-200"
    : "bg-slate-50 text-slate-800 border-slate-200";

  const isBusy = checkIn.isPending || checkOut.isPending || markOnLeave.isPending;

  return (
    <AuthGate allowedRoles={["employee"]}>
      <div>
        <div className="text-xs font-medium text-slate-500">Employee</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Personal dashboard
        </h1>

        <div className="mt-6 rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80 hover:-translate-y-1">
          <div className="text-sm font-medium text-slate-800">Signed in as</div>
          <div className="mt-2 text-sm text-slate-600">
            <div>Name: {userDoc?.displayName ?? userDoc?.email}</div>
            {userDoc?.employeeId && (
              <div className="font-mono text-indigo-600 font-medium">ID: {userDoc.employeeId}</div>
            )}
            <div className="text-xs text-slate-400 mt-1">UID: {userDoc?.uid}</div>
            <div>Role: {userDoc?.role}</div>
            <div>Status: {userDoc?.status}</div>
            <div>Team lead: {userDoc?.teamLeadId ?? "—"}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80 hover:-translate-y-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold tracking-tight">
                  Attendance today
                </div>
                <div className="mt-1 text-xs text-slate-500">{todayKey}</div>
              </div>
              <div className={`rounded-full border px-3 py-1 text-xs font-medium ${statusTone}`}>
                {statusLabel}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                disabled={
                  !uid ||
                  isBusy ||
                  todayPresence?.status === "checked_in" ||
                  todayPresence?.status === "on_leave"
                }
                onClick={() => {
                  if (!uid) return;
                  setActionError(null);
                  checkIn.mutate(
                    { uid },
                    {
                      onError: (err) =>
                        setActionError(err instanceof Error ? err.message : "Check-in failed"),
                    },
                  );
                }}
                className="inline-flex h-10 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {checkIn.isPending ? "Checking in…" : "Check in"}
              </button>
              <button
                type="button"
                disabled={!uid || isBusy || todayPresence?.status !== "checked_in"}
                onClick={() => {
                  if (!uid) return;
                  setActionError(null);
                  checkOut.mutate(
                    { uid },
                    {
                      onError: (err) =>
                        setActionError(err instanceof Error ? err.message : "Check-out failed"),
                    },
                  );
                }}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                {checkOut.isPending ? "Checking out…" : "Check out"}
              </button>
              <button
                type="button"
                disabled={!uid || isBusy || todayPresence?.status === "checked_in"}
                onClick={() => {
                  if (!uid) return;
                  setActionError(null);
                  markOnLeave.mutate(
                    { uid },
                    {
                      onError: (err) =>
                        setActionError(err instanceof Error ? err.message : "Update failed"),
                    },
                  );
                }}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                {markOnLeave.isPending ? "Updating…" : "On leave"}
              </button>
            </div>

            <div className="mt-4 grid gap-2 text-xs text-slate-600">
              <div className="flex items-center justify-between">
                <div>Checked in at</div>
                <div className="font-medium text-slate-800">
                  {formatMaybeTimestamp(todayPresence?.checkedInAt) ?? "—"}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>Checked out at</div>
                <div className="font-medium text-slate-800">
                  {formatMaybeTimestamp(todayPresence?.checkedOutAt) ?? "—"}
                </div>
              </div>
            </div>

            {presenceQuery.error || actionError ? (
              <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {actionError ??
                  (presenceQuery.error instanceof Error
                    ? presenceQuery.error.message
                    : "Attendance error")}
              </div>
            ) : null}
          </div>

          <div className="rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80 hover:-translate-y-1">
            <div className="text-sm font-semibold tracking-tight">
              Recent attendance
            </div>
            <div className="mt-1 text-xs text-slate-500">Last 14 days</div>

            {daysQuery.isLoading ? (
              <div className="mt-4 text-sm text-slate-500">Loading…</div>
            ) : daysQuery.error ? (
              <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {daysQuery.error instanceof Error ? daysQuery.error.message : "Failed to load"}
              </div>
            ) : (daysQuery.data?.length ?? 0) === 0 ? (
              <div className="mt-4 text-sm text-slate-500">No records yet.</div>
            ) : (
              <div className="mt-4 overflow-hidden rounded-2xl border border-white/20">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50/50 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">In</th>
                      <th className="px-4 py-3">Out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/50">
                    {(daysQuery.data ?? []).map((d) => (
                      <tr key={d.dateKey} className="hover:bg-white/50 transition-colors">
                        <td className="px-4 py-3">{d.dateKey}</td>
                        <td className="px-4 py-3 capitalize">
                          {d.status.replace("_", " ")}
                        </td>
                        <td className="px-4 py-3">
                          {formatMaybeTimestamp(d.checkedInAt) ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          {formatMaybeTimestamp(d.checkedOutAt) ?? "—"}
                        </td>
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
