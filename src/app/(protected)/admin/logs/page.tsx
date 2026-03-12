"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { db, isFirebaseReady } from "@/lib/firebase/client";

type AuthLogDoc = {
  uid: string;
  email: string | null;
  provider: string;
  event: "login";
  createdAt: unknown;
};

function toDate(ts: Timestamp | Date | string | number) {
  return ts && typeof (ts as Timestamp).toDate === "function"
    ? (ts as Timestamp).toDate()
    : new Date(ts as Date | string | number);
}

export default function SystemLogsPage() {
  const [logs, setLogs] = useState<AuthLogDoc[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "7d">("all");
  const { userDoc } = useAuth();

  const logQuery = useMemo(() => {
    if (!db || !isFirebaseReady) return null;
    const isAdmin = (userDoc?.role ?? "") === "admin" || (userDoc?.orgRole ?? "") === "SUPER_ADMIN";
    if (!isAdmin) return null;
    return query(
      collection(db, "authLogs"),
      orderBy("createdAt", "desc"),
      limit(81),
    );
  }, [userDoc?.role, userDoc?.orgRole]);

  useEffect(() => {
    if (!logQuery) return;
    return onSnapshot(logQuery, (snap) => {
      setLogs(snap.docs.map((d) => d.data() as AuthLogDoc));
    }, (error: unknown) => {
      const err = error as { code?: string };
      if (typeof err?.code === "string" && err.code === "permission-denied") return;
      console.error("System logs listener error", error);
    });
  }, [logQuery]);

  const filteredLogs = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

    return logs.filter((entry) => {
      if (providerFilter !== "all" && String(entry.provider || "").toLowerCase() !== providerFilter) {
        return false;
      }

      const createdAt = toDate(entry.createdAt as Timestamp | Date | string | number).getTime();
      if (dateFilter === "today" && createdAt < todayStart) return false;
      if (dateFilter === "7d" && createdAt < sevenDaysAgo) return false;

      if (!normalizedSearch) return true;
      const haystack = [entry.email ?? "", entry.uid ?? "", entry.provider ?? "", entry.event ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [dateFilter, logs, providerFilter, searchTerm]);

  return (
    <AuthGate allowedRoles={["admin"]} allowedOrgRoles={["SUPER_ADMIN"]}>
      <div className="min-h-screen bg-white text-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="text-xs font-medium text-slate-500">Admin</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">System Logs</h1>
          <div className="mt-6 rounded-[24px] bg-white/70 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-md">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold tracking-tight">Recent Auth Events</div>
              <div className="text-xs text-slate-500">{filteredLogs.length} / {logs.length}</div>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-[1.2fr_0.9fr_0.9fr]">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search</span>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Email, UID, provider"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Provider</span>
                <select
                  value={providerFilter}
                  onChange={(event) => setProviderFilter(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                >
                  <option value="all">All providers</option>
                  <option value="google.com">Google</option>
                  <option value="password">Password</option>
                  <option value="phone">Phone</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date window</span>
                <select
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value as "all" | "today" | "7d")}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                >
                  <option value="all">All time</option>
                  <option value="today">Today</option>
                  <option value="7d">Last 7 days</option>
                </select>
              </label>
            </div>
            <div className="mt-4">
              {filteredLogs.length === 0 ? (
                <div className="py-4 text-sm text-slate-600">No logs.</div>
              ) : (
                filteredLogs.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1.6fr_1fr_1.2fr] items-center gap-3 py-2 text-sm">
                    <div className="truncate">
                      <span className="font-semibold">{l.email ?? "-"}</span>
                      <span className="ml-2 text-xs text-slate-500">UID: {l.uid.slice(0, 8)}...</span>
                    </div>
                    <div className="text-slate-600">{l.provider}</div>
                    <div className="text-right text-xs text-slate-500">
                      {toDate(l.createdAt as Timestamp | Date | string | number).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
