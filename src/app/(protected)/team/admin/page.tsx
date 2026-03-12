"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db, isFirebaseReady } from "@/lib/firebase/client";
import { getTodayKey } from "@/lib/firebase/attendance";
import { applyBulkLeadActions } from "@/lib/crm/bulk-actions";
import { transferLeadCustody } from "@/lib/crm/custody";
import { buildLeadActor } from "@/lib/crm/timeline";
import type { UserDoc } from "@/lib/types/user";
import type { LeadDoc } from "@/lib/types/crm";
import { isLeadDistributable } from "@/lib/utils/leadLogic";
import { motion } from "framer-motion";
import { buildTaskWriteFields } from "@/lib/tasks/model";

type PresenceRow = {
  uid: string;
  status: "checked_in" | "checked_out" | "on_leave";
  checkedInAt: Timestamp | Date | string | number | null;
  checkedOutAt: Timestamp | Date | string | number | null;
};

type TaskStatus = "pending" | "in_progress" | "completed";
type TaskPriority = "high" | "medium" | "low";

function toDate(ts: Timestamp | Date | string | number | null | undefined) {
  if (!ts) return null;
  return (ts as Timestamp).toDate ? (ts as Timestamp).toDate() : new Date(ts as Date | string | number);
}

function hoursBetween(a: Timestamp | Date | string | number | null | undefined, b: Timestamp | Date | string | number | null | undefined) {
  const ad = toDate(a);
  const bd = toDate(b);
  if (!ad || !bd) return 0;
  const ms = Math.max(0, bd.getTime() - ad.getTime());
  return Math.round((ms / (1000 * 60 * 60)) * 10) / 10;
}

function chunk<T>(arr: T[], size = 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function TeamAdminControlTowerPage() {
  const { firebaseUser, userDoc } = useAuth();
  const uid = firebaseUser?.uid ?? null;
  const todayKey = useMemo(() => getTodayKey(), []);
  const actor = useMemo(
    () =>
      userDoc
        ? buildLeadActor({
            uid: userDoc.uid,
            displayName: userDoc.displayName,
            email: userDoc.email,
            role: userDoc.role,
            orgRole: userDoc.orgRole,
            employeeId: userDoc.employeeId ?? null,
          })
        : null,
    [userDoc],
  );

  const [employees, setEmployees] = useState<Array<Pick<UserDoc, "uid" | "displayName" | "role" | "photoURL" | "monthlyTarget">>>([]);
  const [presence, setPresence] = useState<Record<string, PresenceRow>>({});
  const [subSelection, setSubSelection] = useState<Record<string, boolean>>({});
  const [unassignedLeads, setUnassignedLeads] = useState<LeadDoc[]>([]);
  const [selectedUnassignedLeadIds, setSelectedUnassignedLeadIds] = useState<string[]>([]);
  const [assignLeadTarget, setAssignLeadTarget] = useState<string>("");
  const [assigningLeads, setAssigningLeads] = useState(false);
  const [quickTask, setQuickTask] = useState<{ title: string; priority: TaskPriority; deadline: string | null; status: TaskStatus }>({
    title: "",
    priority: "medium",
    deadline: null,
    status: "pending",
  });
  const [ackCategory, setAckCategory] = useState<"Top Closer" | "Fastest Response" | "Quality Excellence">("Top Closer");

  useEffect(() => {
    if (!isFirebaseReady || !db || !uid || !userDoc) return;
    const isTeamLead = userDoc.role === "teamLead";
    const isAdmin = userDoc.role === "admin" || userDoc.orgRole === "SUPER_ADMIN";
    if (!isTeamLead && !isAdmin) return;

    const q1 = query(collection(db, "users"), where("reportsTo", "==", uid), where("role", "==", "employee"), where("status", "==", "active"), limit(500));
    const q2 = query(collection(db, "users"), where("teamLeadId", "==", uid), where("role", "==", "employee"), where("status", "==", "active"), limit(500));
    const q3 = query(collection(db, "users"), where("managerId", "==", uid), where("role", "==", "employee"), where("status", "==", "active"), limit(500));
    Promise.all([getDocs(q1), getDocs(q2), getDocs(q3)]).then(([s1, s2, s3]) => {
      const map = new Map<string, Pick<UserDoc, "uid" | "displayName" | "role" | "photoURL" | "monthlyTarget">>();
      for (const snap of [s1, s2, s3]) {
        for (const d of snap.docs) {
          const raw = d.data() as UserDoc;
          const key = raw.uid ?? d.id;
          map.set(key, {
            uid: key,
            displayName: raw.displayName ?? null,
            role: raw.role,
            photoURL: raw.photoURL ?? null,
            monthlyTarget: typeof raw.monthlyTarget === "number" ? raw.monthlyTarget : null,
          });
        }
      }
      setEmployees(Array.from(map.values()));
    }).catch(() => {});
  }, [uid, userDoc]);

  useEffect(() => {
    if (!isFirebaseReady || !db || employees.length === 0) return;
    const uids = employees.map((e) => e.uid);
    const unsubs: Array<() => void> = [];
    for (const part of chunk(uids, 10)) {
      const pq = query(collection(db, "presence"), where("uid", "in", part));
      const unsub = onSnapshot(
        pq,
        (snap) => {
          const next: Record<string, PresenceRow> = {};
          for (const d of snap.docs) {
            const raw = d.data() as PresenceRow;
            const k = (raw.uid ?? d.id) as string;
            next[k] = { ...raw, uid: k };
          }
          setPresence((prev) => ({ ...prev, ...next }));
        },
        (error) => {
          if ((error as { code?: string })?.code === "permission-denied") return;
          console.error("Team admin presence listener error", error);
        },
      );
      unsubs.push(unsub);
    }
    return () => { for (const u of unsubs) u(); };
  }, [employees]);

  useEffect(() => {
    if (!isFirebaseReady || !db) return;
    const isAdmin = (userDoc?.role ?? "") === "admin" || (userDoc?.orgRole ?? "") === "SUPER_ADMIN";
    if (!isAdmin) return;
    const q = query(collection(db, "leads"), where("assignedTo", "==", null), limit(200));
    return onSnapshot(
      q,
      (snap) => {
        const leads = snap.docs.map((d) => d.data() as LeadDoc);
        setUnassignedLeads(leads.filter(l => isLeadDistributable(l)));
      },
      () => {
        // Unauthorized users shouldn't see unassigned leads; ignore errors
      },
    );
  }, [userDoc?.role, userDoc?.orgRole]);

  useEffect(() => {
    const allowed = new Set(unassignedLeads.map((lead) => lead.leadId));
    setSelectedUnassignedLeadIds((current) => current.filter((leadId) => allowed.has(leadId)));
  }, [unassignedLeads]);

  function avatarFor(e: Pick<UserDoc, "uid" | "displayName" | "photoURL">) {
    const initials = (e.displayName ?? e.uid).split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
    return (
      <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white text-xs font-semibold">
        {initials}
      </div>
    );
  }

  function statusDot(uidX: string) {
    const s = presence[uidX]?.status ?? "checked_out";
    return s === "checked_in" ? "bg-emerald-500" : s === "on_leave" ? "bg-amber-500" : "bg-slate-400";
  }

  async function assignLeadTransaction(leadId: string, assigneeUid: string) {
    if (!db || !uid || !assigneeUid || !actor) return;
    const snap = await getDoc(doc(db, "leads", leadId));
    if (!snap.exists()) throw new Error("Lead not found");
    const data = { ...(snap.data() as LeadDoc), leadId };
    if (data.assignedTo && data.assignedTo !== assigneeUid) {
      throw new Error("Lead already assigned");
    }
    await transferLeadCustody({
      lead: data,
      actor,
      nextOwnerUid: assigneeUid,
      reason: "Team admin assignment",
      reassignOpenTasks: true,
      workflowRemarks: "Team admin assignment",
    });
  }

  function toggleUnassignedLeadSelection(leadId: string) {
    setSelectedUnassignedLeadIds((current) =>
      current.includes(leadId)
        ? current.filter((value) => value !== leadId)
        : [...current, leadId],
    );
  }

  function toggleAllUnassignedLeadSelection() {
    const allLeadIds = unassignedLeads.map((lead) => lead.leadId);
    setSelectedUnassignedLeadIds((current) => {
      const allSelected = allLeadIds.length > 0 && allLeadIds.every((leadId) => current.includes(leadId));
      if (allSelected) return [];
      return allLeadIds;
    });
  }

  async function assignSelectedLeads() {
    if (!actor || !assignLeadTarget || selectedUnassignedLeadIds.length === 0) return;
    const leads = unassignedLeads.filter((lead) => selectedUnassignedLeadIds.includes(lead.leadId));
    if (leads.length === 0) return;
    setAssigningLeads(true);
    try {
      const result = await applyBulkLeadActions({
        leads,
        actor,
        assignTo: assignLeadTarget,
        transferReason: "Team admin assignment",
        remarks: "Team admin explicit selection assignment",
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
      setUnassignedLeads((current) =>
        current.filter((lead) => !selectedUnassignedLeadIds.includes(lead.leadId)),
      );
      setSelectedUnassignedLeadIds([]);
      setAssignLeadTarget("");
    } finally {
      setAssigningLeads(false);
    }
  }

  async function bulkAssignQuickTask() {
    if (!db || !uid || !quickTask.title.trim()) return;
    const targets = Object.keys(subSelection).filter((k) => subSelection[k]);
    for (const t of targets) {
      const taskRef = doc(collection(db, "tasks"));
      await setDoc(taskRef, {
        id: taskRef.id,
        title: quickTask.title.trim(),
        description: "",
        ...buildTaskWriteFields({ assigneeUid: t, creatorUid: uid }),
        status: quickTask.status,
        priority: quickTask.priority,
        createdAt: serverTimestamp(),
        deadline: quickTask.deadline ? new Date(quickTask.deadline) : null,
      } as Partial<{
        id: string;
        title: string;
        description: string;
        assignedTo: string;
        assigneeUid: string;
        assignedBy: string;
        createdBy: string;
        status: TaskStatus;
        priority: TaskPriority;
        createdAt: unknown;
        deadline?: unknown | null;
      }>, { merge: true });

      const notifRef = doc(collection(db, "notifications"));
      await setDoc(notifRef, {
        recipientUid: t,
        title: "New Task Assigned",
        body: `Quick Task Assigned: ${quickTask.title.trim()}`,
        read: false,
        createdAt: serverTimestamp(),
        relatedTaskId: taskRef.id,
        priority: quickTask.priority,
      });
    }
    setQuickTask({ title: "", priority: "medium", deadline: null, status: "pending" });
    setSubSelection({});
    alert(`Assigned to ${targets.length} people`);
  }

  async function markAchievement(userId: string) {
    if (!db || !uid) return;
    const ref = doc(collection(db, "users", userId, "achievements"));
    await setDoc(ref, {
      id: ref.id,
      category: ackCategory,
      assignedBy: uid,
      createdAt: serverTimestamp(),
    }, { merge: true });
  }

  async function toggleApproveOT(userId: string, approve: boolean) {
    if (!db) return;
    const k = todayKey;
    const yyyy = k.slice(0, 4);
    const mm = k.slice(5, 7);
    const dayRef = doc(db, "users", userId, "attendance", yyyy, "months", mm, "days", k);
    await setDoc(dayRef, { isOTApproved: approve, updatedAt: serverTimestamp() }, { merge: true });
  }

  async function updateMonthlyTarget(userId: string, nextTarget: number) {
    if (!db) return;
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, { monthlyTarget: nextTarget, updatedAt: serverTimestamp() });
  }

  return (
    <AuthGate allowedRoles={["teamLead"]} allowedOrgRoles={["TEAM_LEAD", "SUPER_ADMIN"]}>
      <div className="min-h-screen bg-white text-slate-900">
        <div className="pointer-events-none fixed inset-0 opacity-[0.35]">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(600px 200px at 20% 10%, rgba(79,70,229,0.12), transparent 60%), radial-gradient(500px 200px at 80% 20%, rgba(16,185,129,0.12), transparent 60%)",
            }}
          />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <header className="mb-6 flex items-center justify-between">
            <div className="text-sm font-semibold tracking-wide text-slate-500">Team Lead Control Tower</div>
            <div className="inline-flex rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-700 backdrop-blur-md border border-white/20 shadow-sm">
              {todayKey}
            </div>
          </header>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-[24px] border border-white/20 bg-white/70 p-4 backdrop-blur-md shadow-sm lg:col-span-1">
              <div className="text-sm font-semibold">People & Workload</div>
              <div className="mt-3 space-y-2">
                {employees.map((e) => {
                  const p = presence[e.uid];
                  const activeHours = p?.status === "checked_in" ? hoursBetween(p?.checkedInAt, new Date()) : hoursBetween(p?.checkedInAt, p?.checkedOutAt);
                  return (
                    <div key={e.uid} className="flex items-center justify-between rounded-xl bg-white/80 px-3 py-2">
                      <div className="flex items-center gap-2">
                        {avatarFor(e)}
                        <div>
                          <div className="text-sm font-semibold">{e.displayName ?? e.uid}</div>
                          <div className="text-[11px] text-slate-500 inline-flex items-center gap-2">
                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(e.uid)}`} />
                            <span>{p?.status ?? "checked_out"}</span>
                            <span>• {activeHours}h</span>
                          </div>
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={Boolean(subSelection[e.uid])}
                          onChange={(ev) => setSubSelection((prev) => ({ ...prev, [e.uid]: ev.target.checked }))}
                        />
                        Select
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/20 bg-white/70 p-4 backdrop-blur-md shadow-sm lg:col-span-1">
              <div className="text-sm font-semibold">Lead & Task Assignment</div>
              <div className="mt-3">
                <div className="rounded-xl border border-white/20 bg-white/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold">Unassigned Leads</div>
                    <button
                      type="button"
                      onClick={toggleAllUnassignedLeadSelection}
                      disabled={unassignedLeads.length === 0}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {selectedUnassignedLeadIds.length === unassignedLeads.length && unassignedLeads.length > 0
                        ? "Clear all"
                        : "Select all"}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm"
                      value={assignLeadTarget}
                      onChange={(event) => setAssignLeadTarget(event.target.value)}
                    >
                      <option value="">Assign selected to...</option>
                      {employees.map((user) => (
                        <option key={user.uid} value={user.uid}>
                          {user.displayName ?? user.uid}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void assignSelectedLeads()}
                      disabled={assigningLeads || !assignLeadTarget || selectedUnassignedLeadIds.length === 0}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {assigningLeads
                        ? "Assigning..."
                        : `Assign ${selectedUnassignedLeadIds.length} selected`}
                    </button>
                  </div>
                  <div className="mt-2 max-h-64 overflow-auto space-y-2">
                    {unassignedLeads.map((l) => (
                      <div key={l.leadId} className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-xs">
                        <label className="flex min-w-0 items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selectedUnassignedLeadIds.includes(l.leadId)}
                            onChange={() => toggleUnassignedLeadSelection(l.leadId)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="truncate font-medium">{l.name}</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedUnassignedLeadIds([l.leadId]);
                          }}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Pick only
                        </button>
                      </div>
                    ))}
                    {unassignedLeads.length === 0 ? (
                      <div className="rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-600">No unassigned leads</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-white/20 bg-white/70 p-3">
                <div className="text-xs font-semibold">Quick Task</div>
                <div className="mt-2 space-y-2">
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    placeholder="Task Title"
                    value={quickTask.title}
                    onChange={(e) => setQuickTask((p) => ({ ...p, title: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      value={quickTask.priority}
                      onChange={(e) => setQuickTask((p) => ({ ...p, priority: e.target.value as TaskPriority }))}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      value={quickTask.status}
                      onChange={(e) => setQuickTask((p) => ({ ...p, status: e.target.value as TaskStatus }))}
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
                    <input
                      type="date"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      value={quickTask.deadline ?? ""}
                      onChange={(e) => setQuickTask((p) => ({ ...p, deadline: e.target.value || null }))}
                    />
                  </div>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                    onClick={() => void bulkAssignQuickTask()}
                  >
                    Assign to selected
                  </motion.button>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/20 bg-white/70 p-4 backdrop-blur-md shadow-sm lg:col-span-1">
              <div className="text-sm font-semibold">Recognition & Overtime</div>
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-white/20 bg-white/70 p-3">
                  <div className="text-xs font-semibold">Achievements</div>
                  <div className="mt-2 space-y-2">
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      value={ackCategory}
                      onChange={(e) => setAckCategory(e.target.value as typeof ackCategory)}
                    >
                      <option value="Top Closer">Top Closer</option>
                      <option value="Fastest Response">Fastest Response</option>
                      <option value="Quality Excellence">Quality Excellence</option>
                    </select>
                    {employees.map((e) => (
                      <div key={e.uid} className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-xs">
                        <div className="font-medium">{e.displayName ?? e.uid}</div>
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.98 }}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                          onClick={() => void markAchievement(e.uid)}
                        >
                          Mark Achievement
                        </motion.button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/20 bg-white/70 p-3">
                  <div className="text-xs font-semibold">Overtime & Attendance</div>
                  <div className="mt-2 space-y-2">
                    {employees.map((e) => {
                      const p = presence[e.uid];
                      const activeHours = p?.status === "checked_in" ? hoursBetween(p?.checkedInAt, new Date()) : hoursBetween(p?.checkedInAt, p?.checkedOutAt);
                      const overtime = activeHours > 8;
                      return (
                        <div key={e.uid} className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-xs">
                          <div className="font-medium">{e.displayName ?? e.uid}</div>
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300"
                              checked={overtime}
                              onChange={(ev) => void toggleApproveOT(e.uid, ev.target.checked)}
                            />
                            Approve OT
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-white/20 bg-white/70 p-3">
                  <div className="text-xs font-semibold">Performance Overrides</div>
                  <div className="mt-2 space-y-2">
                    {employees.map((e) => (
                      <div key={e.uid} className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-xs">
                        <div className="font-medium">{e.displayName ?? e.uid}</div>
                        <div className="inline-flex items-center gap-2">
                          <input
                            type="number"
                            className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                            defaultValue={typeof e.monthlyTarget === "number" ? e.monthlyTarget : 30}
                            onBlur={(ev) => {
                              const val = Number(ev.target.value);
                              if (Number.isFinite(val) && val > 0) void updateMonthlyTarget(e.uid, val);
                            }}
                          />
                          <span className="text-[11px] text-slate-500">Target</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
