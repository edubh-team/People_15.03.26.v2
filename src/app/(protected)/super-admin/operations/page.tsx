"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  getDoc,
  getDocs, 
  query, 
  where, 
  limit,
  orderBy,
  startAfter,
  DocumentSnapshot,
  updateDoc
} from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";
import type { UserDoc } from "@/lib/types/user";
import { PlusIcon, ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon, CheckIcon, XMarkIcon, CalendarIcon, ArrowPathIcon, LockClosedIcon, PhoneIcon, EnvelopeIcon, UserIcon } from "@heroicons/react/24/outline";
import { isLeadDistributable } from "@/lib/utils/leadLogic";
import { LeadDoc } from "@/lib/types/crm";
import { applyBulkLeadActions } from "@/lib/crm/bulk-actions";
import { buildLeadActor } from "@/lib/crm/timeline";
import { toTitleCase } from "@/lib/utils/stringUtils";
import { useHrAttendanceOversight, useHrLeaveAuthority } from "@/lib/people/ops";
import { usePeoplePayrollSnapshot } from "@/lib/people/payroll-workspace";

// --- Components ---

function getTodayDateKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatClock(value: unknown) {
  if (!value) return "-";
  const date =
    typeof value === "object" && value !== null && "toDate" in value
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string | number | Date);

  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateKey(dateStr: string) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function GlobalCalendar() {
  const { userDoc } = useAuth();
  const selectedDate = useMemo(() => getTodayDateKey(), []);
  const { users, attendanceByUid, loading, error } = useHrAttendanceOversight(selectedDate);
  const { snapshot } = usePeoplePayrollSnapshot(userDoc, {
    dateKey: selectedDate,
    refreshMs: 45_000,
  });

  const rows = useMemo(
    () =>
      users.map((user) => {
        const record = attendanceByUid[user.uid];
        const status = (record?.status ?? "").toLowerCase();
        const dayStatus = (record?.dayStatus ?? "").toLowerCase();
        const onLeave = status === "on_leave" || dayStatus === "on_leave" || dayStatus === "leave";
        const present =
          !onLeave &&
          (status === "checked_in" ||
            status === "present" ||
            dayStatus === "present" ||
            dayStatus === "late");

        return {
          uid: user.uid,
          name: user.displayName ?? user.email ?? user.uid,
          status: onLeave ? "on_leave" : present ? "checked_in" : "checked_out",
          checkedInAt: record?.checkedInAt ?? record?.checkInTime ?? null,
        };
      }),
    [attendanceByUid, users],
  );

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">Loading attendance snapshot...</div>;
  }

  if (error) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-700">{error.message}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
          <div className="text-2xl font-bold text-emerald-700">{snapshot.attendancePresent}</div>
          <div className="text-xs font-medium text-emerald-600">Present Today</div>
        </div>
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
          <div className="text-2xl font-bold text-amber-700">{snapshot.onLeaveTodayTotal}</div>
          <div className="text-xs font-medium text-amber-600">On Leave</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="text-2xl font-bold text-slate-700">{snapshot.attendanceAbsent}</div>
          <div className="text-xs font-medium text-slate-500">Absent / Not In</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Active Employees</div>
          <div className="mt-2 text-2xl font-bold text-indigo-900">{snapshot.activeEmployees}</div>
        </div>
        <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-violet-600">Pending Leaves (Org)</div>
          <div className="mt-2 text-2xl font-bold text-violet-900">{snapshot.pendingLeavesTotal}</div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Payroll Records ({snapshot.monthKey})</div>
          <div className="mt-2 text-2xl font-bold text-emerald-900">{snapshot.payrollRecords}</div>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">Pending Payroll Employees</div>
          <div className="mt-2 text-2xl font-bold text-amber-900">{snapshot.pendingPayrollEmployees}</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-[600px] w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-6 py-4">Employee</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Check In</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.uid} className="hover:bg-slate-50/50">
                <td className="px-6 py-4 font-medium text-slate-900">{row.name}</td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      row.status === "checked_in"
                        ? "bg-emerald-100 text-emerald-800"
                        : row.status === "on_leave"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-800"
                    }`}
                  >
                    {row.status === "checked_in" ? "Present" : row.status === "on_leave" ? "On Leave" : "Absent"}
                  </span>
                </td>
                <td className="px-6 py-4 text-right font-mono text-xs text-slate-500">{formatClock(row.checkedInAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeaveAuthority() {
  const { userDoc } = useAuth();
  const { rows: requests, loading, error, updateStatus } = useHrLeaveAuthority(userDoc, "pending");

  const handleAction = async (id: string, status: "approved" | "rejected") => {
    try {
      await updateStatus(id, status);
    } catch (actionError: unknown) {
      alert("Error: " + (actionError instanceof Error ? actionError.message : "Unknown error"));
    }
  };

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">Loading leave queue...</div>;
  }

  if (error) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-700">{error.message}</div>;
  }

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        Pending Requests
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
          {requests.length}
        </span>
      </h3>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center">
          <div className="mb-3 rounded-full bg-white p-3 shadow-sm ring-1 ring-slate-200">
            <CheckIcon className="h-6 w-6 text-emerald-500" />
          </div>
          <h4 className="text-sm font-medium text-slate-900">All caught up!</h4>
          <p className="mt-1 text-xs text-slate-500">No pending leave requests at the moment.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map((request) => {
            const initials = (request.userName || "?")
              .split(" ")
              .map((chunk) => chunk[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();

            return (
              <div key={request.id} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-600 ring-4 ring-white shadow-sm">
                      {initials}
                    </div>
                    <div className="space-y-1">
                      <div>
                        <div className="font-bold text-slate-900">{request.userName || "Unknown User"}</div>
                        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{request.userEmail || "No email"}</div>
                      </div>
                      <div className="mt-1 flex w-fit items-center gap-2 rounded-md bg-slate-50 px-2 py-1 text-sm text-slate-600">
                        <CalendarIcon className="h-4 w-4 text-slate-400" />
                        <span>
                          {formatDateKey(request.startDateKey)} <span className="mx-1 text-slate-300">-</span> {formatDateKey(request.endDateKey)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2 sm:ml-4">
                    <button
                      onClick={() => void handleAction(request.id, "rejected")}
                      className="group/btn flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                    >
                      <XMarkIcon className="h-4 w-4 text-slate-400 group-hover/btn:text-red-500" />
                      Reject
                    </button>
                    <button
                      onClick={() => void handleAction(request.id, "approved")}
                      className="group/btn flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-500 hover:shadow-indigo-200"
                    >
                      <CheckIcon className="h-4 w-4 text-white" />
                      Approve
                    </button>
                  </div>
                </div>

                <div className="mt-4 pl-[4rem]">
                  <div className="relative rounded-lg border-l-4 border-indigo-400 bg-slate-50 p-3 text-sm italic text-slate-700">
                    <span className="absolute -left-1 top-3 h-2 w-2 rounded-full bg-indigo-400"></span>
                    "{request.reason}"
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
const formatRole = (role: string) => {
  if (role === 'super_admin' || role === 'SUPER_ADMIN') return 'Manager';
  if (role === 'manager' || role === 'MANAGER' || role === 'Manager') return 'Manager';
  if (role === 'team_lead' || role === 'TEAM_LEAD' || role === 'Team Lead') return 'Team Lead';
  if (role === 'TL' || role === 'teamLead') return 'Team Lead';
  if (role === 'bdm_training' || role === 'BDM_TRAINING') return 'BDM (Training)';
  if (role === 'bda_trainee' || role === 'BDA_TRAINEE' || role === 'BDAT') return 'BDA (Trainee)';
  if (role === 'bda' || role === 'BDA' || role === 'EMPLOYEE') return 'BDA';
  return role;
};

function LeadDistribution() {
  const { userDoc } = useAuth();
  const actor = userDoc
    ? buildLeadActor({
        uid: userDoc.uid,
        displayName: userDoc.displayName,
        email: userDoc.email,
        role: userDoc.role,
        orgRole: userDoc.orgRole,
        employeeId: userDoc.employeeId ?? null,
      })
    : null;
  const ITEMS_PER_PAGE = 50;
  const [unassigned, setUnassigned] = useState<LeadDoc[]>([]);
  const [managers, setManagers] = useState<UserDoc[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [dragOverManager, setDragOverManager] = useState<string | null>(null);

  // Search State
  const [searchTerm, setSearchTerm] = useState("");
  const [managerSearch, setManagerSearch] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCursors, setPageCursors] = useState<{ [page: number]: DocumentSnapshot | null }>({ 1: null });
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchUnassignedLeads(1, null);
    fetchManagers();
  }, []);

  // Search Effect
  useEffect(() => {
    if (!searchTerm) {
        if (isSearching) {
            setIsSearching(false);
            fetchUnassignedLeads(1, null);
        }
        return;
    }

    const handler = setTimeout(async () => {
        setIsSearching(true);
        setLoading(true);
        try {
            const term = searchTerm.trim();
            const queries: Promise<DocumentSnapshot[]>[] = [];

            // 1. ID
            queries.push(getDoc(doc(db!, 'leads', term)).then(s => s.exists() ? [s] : []));
            
            // 2. Phone
            if (term.length >= 3) {
                queries.push(getDocs(query(collection(db!, 'leads'), 
                    where('phone', '>=', term), 
                    where('phone', '<=', term + '\uf8ff'), 
                    limit(10)
                )).then(s => s.docs));
            }

            // 3. Email
            if (term.length >= 3) {
                 queries.push(getDocs(query(collection(db!, 'leads'), 
                    where('email', '>=', term), 
                    where('email', '<=', term + '\uf8ff'), 
                    limit(10)
                )).then(s => s.docs));
            }

            // 4. Name
            if (term.length >= 2) {
                const titleTerm = toTitleCase(term);
                const terms = new Set([term, titleTerm]);
                terms.forEach(t => {
                    queries.push(getDocs(query(collection(db!, 'leads'), 
                        where('name', '>=', t), 
                        where('name', '<=', t + '\uf8ff'), 
                        limit(10)
                    )).then(s => s.docs));
                });
            }

            const results = await Promise.all(queries);
            const flat = results.flat();
            const seen = new Set<string>();
            const unique: LeadDoc[] = [];

            flat.forEach(d => {
                if (seen.has(d.id)) return;
                seen.add(d.id);
                const data = { ...d.data(), leadId: d.id } as LeadDoc;
                if (data.assignedTo === null && isLeadDistributable(data)) {
                    unique.push(data);
                }
            });

            setUnassigned(unique);
            setHasMore(false);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, 500);

    return () => clearTimeout(handler);
  }, [searchTerm]);

  const fetchUnassignedLeads = async (page: number, cursor: DocumentSnapshot | null) => {
    if (!db) return;
    setLoading(true);
    try {
      let q = query(
        collection(db, "leads"), 
        where("assignedTo", "==", null),
        orderBy("createdAt", "desc"), // Ensure consistent ordering
        limit(ITEMS_PER_PAGE)
      );

      if (cursor) {
        q = query(q, startAfter(cursor));
      }

      const snap = await getDocs(q);
      const leads = snap.docs.map(d => ({ ...d.data(), leadId: d.id } as LeadDoc));
      
      // Filter out completed Payment Follow Ups and Revenue Leads
      const filtered = leads.filter(l => isLeadDistributable(l));
      
      setUnassigned(filtered);
      setHasMore(snap.docs.length === ITEMS_PER_PAGE);
      setCurrentPage(page);

      if (snap.docs.length > 0) {
        const lastDoc = snap.docs[snap.docs.length - 1];
        setPageCursors(prev => ({
          ...prev,
          [page + 1]: lastDoc
        }));
      }
    } catch (e) {
      console.error("Failed to fetch leads", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchManagers = async () => {
    if (!db) return;
    const mq = query(collection(db, "users"), where("status", "==", "active"));
    const snap = await getDocs(mq);
    const allUsers = snap.docs.map(d => d.data() as UserDoc);
    const eligible = allUsers.filter(u => {
      const r = (u.role || "").toLowerCase();
      const o = (u.orgRole || "").toLowerCase();
      return (
        r.includes("manager") || o.includes("manager") ||
        r.includes("admin") || o.includes("admin") ||
        r.includes("lead") || o.includes("lead") ||
        r.includes("tl") || o.includes("tl") ||
        r.includes("employee") || o.includes("employee") ||
        r.includes("bda") || o.includes("bda")
      );
    });
    setManagers(eligible);
  };

  const handleNextPage = () => {
    const nextPage = currentPage + 1;
    const cursor = pageCursors[nextPage];
    if (cursor) {
      fetchUnassignedLeads(nextPage, cursor);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      const prevPage = currentPage - 1;
      const cursor = pageCursors[prevPage];
      fetchUnassignedLeads(prevPage, cursor);
    }
  };

  const PaginationControls = () => (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-700">
            <span className="hidden sm:inline">Showing </span>
            <span className="font-medium">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span>
            <span className="hidden sm:inline"> to </span>
            <span className="sm:hidden">-</span>
            <span className="font-medium">{Math.min(currentPage * ITEMS_PER_PAGE, (currentPage - 1) * ITEMS_PER_PAGE + unassigned.length)}</span>
            <span className="hidden sm:inline"> results</span>
          </p>
        </div>
        <div>
          <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1 || loading}
              className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Previous</span>
              <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              onClick={handleNextPage}
              disabled={!hasMore || loading}
              className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Next</span>
              <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </nav>
        </div>
      </div>
    </div>
  );

  const assignLeadIds = async (leadIds: string[], targetUid?: string) => {
    const target = targetUid || assignTo;
    if (!db || !target || leadIds.length === 0 || !actor) return;
    const leads = unassigned.filter((lead) => leadIds.includes(lead.leadId));
    if (leads.length === 0) return;
    setAssigning(true);
    try {
      const result = await applyBulkLeadActions({
        leads,
        actor,
        assignTo: target,
        transferReason: "Operations lead distribution",
        remarks: "Operations explicit selection assignment",
      });
      if (result.writeFailures.length > 0 || result.sideEffectFailures.length > 0) {
        alert(
          [
            result.writeFailures.length > 0
              ? `${result.writeFailures.length} write failure${result.writeFailures.length === 1 ? "" : "s"}`
              : null,
            result.sideEffectFailures.length > 0
              ? `${result.sideEffectFailures.length} sync failure${result.sideEffectFailures.length === 1 ? "" : "s"}`
              : null,
            result.batchId ? `Batch: ${result.batchId}` : null,
          ]
            .filter(Boolean)
            .join(" | "),
        );
      }
      setUnassigned((prev) => prev.filter((lead) => !leadIds.includes(lead.leadId)));
      setSelectedLeads((prev) => {
        const next = new Set(prev);
        leadIds.forEach((leadId) => next.delete(leadId));
        return next;
      });
      if (!targetUid) {
        setAssignTo("");
      }
    } catch (e: unknown) {
      alert("Error: " + (e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setAssigning(false);
    }
  };

  const handleBulkAssign = async (targetUid?: string) => {
    await assignLeadIds(Array.from(selectedLeads), targetUid);
  };

  const onDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.effectAllowed = "move";
    // If dragging a selected row, move all selected. If unselected, move just this one.
    const idsToMove = selectedLeads.has(leadId) ? Array.from(selectedLeads) : [leadId];
    e.dataTransfer.setData("application/json", JSON.stringify(idsToMove));
    
    // Visual feedback
    const ghost = document.createElement("div");
    ghost.textContent = `Moving ${idsToMove.length} Lead${idsToMove.length > 1 ? 's' : ''}`;
    ghost.style.background = "#4f46e5";
    ghost.style.color = "white";
    ghost.style.padding = "8px 12px";
    ghost.style.borderRadius = "8px";
    ghost.style.position = "absolute";
    ghost.style.top = "-1000px";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const onDrop = async (e: React.DragEvent, managerUid: string) => {
    e.preventDefault();
    setDragOverManager(null);
    const data = e.dataTransfer.getData("application/json");
    if (!data) return;
    
    try {
      const ids = JSON.parse(data);
      if (Array.isArray(ids) && ids.length > 0) {
        await assignLeadIds(ids, managerUid);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredManagers = managers.filter(m => 
    (m.displayName || "").toLowerCase().includes(managerSearch.toLowerCase()) ||
    formatRole(m.orgRole || "").toLowerCase().includes(managerSearch.toLowerCase())
  );

  const groupedManagers = filteredManagers.reduce((acc, m) => {
    const role = formatRole(m.orgRole || "BDA");
    if (!acc[role]) acc[role] = [];
    acc[role].push(m);
    return acc;
  }, {} as Record<string, UserDoc[]>);

  const roleOrder = ["Manager", "Team Lead", "BDA"];
  const sortedGroups = Object.entries(groupedManagers).sort((a, b) => {
    const indexA = roleOrder.indexOf(a[0]);
    const indexB = roleOrder.indexOf(b[0]);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a[0].localeCompare(b[0]);
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-slate-900">Lead Distribution</h2>
        <Link
          href="/crm/leads?surface=workbench&import=1"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          <PlusIcon className="w-5 h-5" />
          <span>Import in CRM</span>
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Left: Leads List */}
      <div className="lg:col-span-2 space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <MagnifyingGlassIcon className="h-5 w-5 text-slate-400" />
          </div>
          <input 
            type="text"
            className="block w-full rounded-lg border-slate-200 bg-white py-2 pl-10 pr-3 text-sm placeholder:text-slate-500 focus:border-indigo-500 focus:ring-indigo-500 shadow-sm"
            placeholder="Search unassigned leads by ID, name, phone, or email..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="relative flex-1">
            <select 
              className="w-full appearance-none rounded-lg border-slate-200 bg-white px-4 py-2 pr-8 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              value={assignTo}
              onChange={e => setAssignTo(e.target.value)}
            >
              <option value="">Assign selected to...</option>
              {managers.map(m => (
                <option key={m.uid} value={m.uid}>{m.displayName} ({formatRole(m.orgRole || "")})</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
              <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </div>
          </div>
          <button 
            onClick={() => handleBulkAssign()}
            disabled={assigning || !assignTo || selectedLeads.size === 0}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            {assigning ? "Assigning..." : `Assign ${selectedLeads.size} Leads`}
          </button>
        </div>

        <div className="bg-slate-50 px-4 py-3 rounded-lg border border-slate-200">
          <PaginationControls />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 min-w-[600px]">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-6 py-4 w-10">
                    <input 
                      type="checkbox" 
                      onChange={(e) => {
                        const next = new Set(selectedLeads);
                        if (e.target.checked) {
                          unassigned.forEach(l => next.add(l.leadId));
                        } else {
                          unassigned.forEach(l => next.delete(l.leadId));
                        }
                        setSelectedLeads(next);
                      }}
                      checked={unassigned.length > 0 && unassigned.every(l => selectedLeads.has(l.leadId))}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th className="px-6 py-4">
                    Lead Name 
                    <span className="ml-1 text-slate-400 font-normal">({unassigned.length})</span>
                    {selectedLeads.size > 0 && (
                      <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                        {selectedLeads.size} Selected
                      </span>
                    )}
                  </th>
                  <th className="px-6 py-4">Phone</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unassigned.map(l => (
                  <tr 
                    key={l.leadId} 
                    draggable
                    onDragStart={(e) => onDragStart(e, l.leadId)}
                    className={`hover:bg-slate-50/50 cursor-grab active:cursor-grabbing ${selectedLeads.has(l.leadId) ? "bg-indigo-50/30" : ""}`}
                  >
                    <td className="px-6 py-4">
                      <input 
                        type="checkbox" 
                        checked={selectedLeads.has(l.leadId)}
                        onChange={(e) => {
                          const next = new Set(selectedLeads);
                          if (e.target.checked) next.add(l.leadId);
                          else next.delete(l.leadId);
                          setSelectedLeads(next);
                        }}
                      />
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-900">{l.name}</td>
                    <td className="px-6 py-4 font-mono text-xs">{l.phone}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-800">
                        Unassigned
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unassigned.length === 0 && (
            <div className="p-8 text-center text-slate-500">No unassigned leads found.</div>
          )}
          <div className="bg-slate-50 px-4 py-3 border-t border-slate-200">
            <PaginationControls />
          </div>
        </div>
      </div>

      {/* Right: Managers Drop Zone */}
      <div className="flex flex-col space-y-4 h-[calc(100vh-200px)] sticky top-6">
        <div className="flex items-center justify-between">
           <h3 className="text-sm font-semibold text-slate-900">Active Team</h3>
           <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{managers.length} Active</span>
        </div>
        
        {/* Manager Search */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
             <MagnifyingGlassIcon className="h-4 w-4 text-slate-400" />
          </div>
          <input 
            type="text"
            className="block w-full rounded-lg border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-500 focus:border-indigo-500 focus:ring-indigo-500 shadow-sm transition-shadow"
            placeholder="Find team member..."
            value={managerSearch}
            onChange={e => setManagerSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto pr-2 space-y-6 custom-scrollbar pb-4">
           {sortedGroups.map(([role, roleManagers]) => (
             <div key={role} className="space-y-3">
               <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur py-2 border-b border-slate-200/50">
                 <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                   {role} 
                   <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] text-slate-600">
                     {roleManagers.length}
                   </span>
                 </h4>
               </div>
               <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                 {roleManagers.map(m => {
                    const isDragOver = dragOverManager === m.uid;
                    const initials = (m.displayName || "?").split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                    
                    return (
                    <div
                      key={m.uid}
                      onDragOver={(e) => { e.preventDefault(); setDragOverManager(m.uid); }}
                      onDragLeave={() => setDragOverManager(null)}
                      onDrop={(e) => onDrop(e, m.uid)}
                      className={`group relative flex items-center gap-4 rounded-xl border p-3 transition-all duration-200 ${
                        isDragOver 
                          ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200 scale-[1.02] shadow-md z-10" 
                          : "border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm"
                      }`}
                    >
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-sm transition-colors ${
                        isDragOver ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600"
                      }`}>
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900 group-hover:text-indigo-900">{m.displayName}</div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                           <span className="truncate">{m.email}</span>
                        </div>
                      </div>
                      
                      {/* Drag Hint Overlay */}
                      {isDragOver && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-indigo-500/10 backdrop-blur-[1px] animate-pulse">
                          <div className="bg-white/90 px-3 py-1 rounded-full shadow-sm text-xs font-bold text-indigo-600 flex items-center gap-1">
                             <PlusIcon className="w-3 h-3" />
                             Drop to Assign
                          </div>
                        </div>
                      )}
                    </div>
                 )})}
               </div>
             </div>
           ))}
           
           {filteredManagers.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center">
              <div className="rounded-full bg-slate-100 p-3 mb-3">
                <MagnifyingGlassIcon className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-900">No matching members</p>
              <p className="text-xs text-slate-500 mt-1">Try adjusting your search</p>
            </div>
           )}
        </div>
      </div>
      
      </div>
    </div>
  );
}

function QualityControl() {
  const [closedLeads, setClosedLeads] = useState<LeadDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "leads"), where("status", "==", "closed"), limit(50));
    getDocs(q).then(snap => {
      setClosedLeads(snap.docs.map(d => ({ ...d.data(), leadId: d.id } as LeadDoc)));
      setLoading(false);
    });
  }, []);

  const handleReopen = async (id: string) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, "leads", id), { status: "hot" }); // Re-open as Hot
      setClosedLeads(prev => prev.filter(l => l.leadId !== id));
    } catch (e: unknown) {
      alert("Error: " + (e instanceof Error ? e.message : "Unknown error"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
           Closed Leads
           <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
             {closedLeads.length}
           </span>
        </h3>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
           {[1,2,3].map(i => (
             <div key={i} className="h-32 rounded-xl bg-slate-100 animate-pulse" />
           ))}
        </div>
      ) : closedLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center">
          <div className="mb-3 rounded-full bg-white p-3 shadow-sm ring-1 ring-slate-200">
            <LockClosedIcon className="h-6 w-6 text-slate-400" />
          </div>
          <h4 className="text-sm font-medium text-slate-900">No closed leads</h4>
          <p className="mt-1 text-xs text-slate-500">Leads marked as closed will appear here for review.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {closedLeads.map(l => (
            <div key={l.leadId} className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-amber-200">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                       <UserIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 text-sm">{l.name}</div>
                      <div className="text-[10px] font-mono text-slate-400">{l.leadId}</div>
                    </div>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 uppercase tracking-wide">
                    Closed
                  </span>
                </div>
                
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <PhoneIcon className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-mono">{l.phone}</span>
                  </div>
                  {l.email && (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <EnvelopeIcon className="h-3.5 w-3.5 text-slate-400" />
                      <span className="truncate">{l.email}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-50">
                <button 
                  onClick={() => handleReopen(l.leadId)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 border border-amber-100"
                >
                  <ArrowPathIcon className="h-3.5 w-3.5" />
                  Re-open Lead
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OperationsPage() {
  const [tab, setTab] = useState("calendar");

  return (
    <AuthGate allowedOrgRoles={["SUPER_ADMIN"]}>
      <div className="min-h-screen bg-slate-50/50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Operations & Governance</h1>
            <p className="mt-1 text-sm text-slate-500">Global Oversight & Lead Distribution</p>
          </div>

          <div className="mb-6 flex space-x-1 rounded-xl bg-slate-200/50 p-1 w-fit overflow-x-auto max-w-full">
            {[
              { id: "calendar", label: "Global Calendar" },
              { id: "leaves", label: "Leave Authority" },
              { id: "leads", label: "Lead Distribution" },
              { id: "qc", label: "Quality Control" },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {tab === "calendar" && <GlobalCalendar />}
              {tab === "leaves" && <LeaveAuthority />}
              {tab === "leads" && <LeadDistribution />}
              {tab === "qc" && <QualityControl />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </AuthGate>
  );
}

