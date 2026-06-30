"use client";

import { useEffect, useMemo, useState } from "react";
import { 
    collection, 
    query, 
    where, 
    limit,
    onSnapshot,
  } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { UserDoc } from "@/lib/types/user";
import { LeadDoc } from "@/lib/types/crm";
import { useAuth } from "@/components/auth/AuthProvider";
import { useScopedUsers } from "@/lib/hooks/useScopedUsers";
import {
  canManageLeadAssignment,
  getAssignableLeadOwners,
} from "@/lib/crm/access";
import { applyBulkLeadActions } from "@/lib/crm/bulk-actions";
import { buildLeadActor } from "@/lib/crm/timeline";
import { 
  UserGroupIcon, 
  ArrowRightIcon, 
  CheckCircleIcon
} from "@heroicons/react/24/outline";
import { toTitleCase } from "@/lib/utils/stringUtils";
import { isLeadDistributable } from "@/lib/utils/leadLogic";
import { normalizeLeadStatus } from "@/lib/leads/status";

export default function LeadDistributorWidget() {
  const { userDoc } = useAuth();
  const { users: scopedUsers, loading: assigneesLoading } = useScopedUsers(userDoc, {
    includeCurrentUser: true,
    includeInactive: false,
  });
  const assignees = useMemo(
    () => getAssignableLeadOwners(userDoc, scopedUsers),
    [scopedUsers, userDoc],
  );
  
  const [myLeads, setMyLeads] = useState<LeadDoc[]>([]);
  const [unassignedLeads, setUnassignedLeads] = useState<LeadDoc[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [targetAssignee, setTargetAssignee] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [transferReason, setTransferReason] = useState("");

  // Fetch leads assigned to current user
  useEffect(() => {
    if (!db || !userDoc) return;

    // Query: assignedTo == current user AND status is New/Pending (we'll assume 'new' or 'followup' or check all)
    // Prompt says: "assignedTo == currentUser.uid AND status == 'New'/'Pending'"
    // In our types we have 'new', 'hot', 'warm', 'followup', 'cold', 'closed'.
    // I'll fetch 'new' and 'followup' as "Pending" equivalent, or just all non-closed.
    // Let's stick to "New" status first as per prompt "status: 'Assigned' (if currently New)".
    
    const q = query(
      collection(db, "leads"),
      where("assignedTo", "==", userDoc.uid),
      // where("status", "in", ["new", "pending"]) // Firestore 'in'
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const leads = snapshot.docs.map(d => ({ ...d.data(), leadId: d.id } as LeadDoc));
      // Filter locally for status if needed, or refine query
      // Let's just show all active leads assigned to me that I can distribute
      setMyLeads(leads.filter(l => 
        ["new", "ringing", "followup", "interested"].includes(normalizeLeadStatus(l.status)) && 
        isLeadDistributable(l)
      )); 
    }, (error) => {
      if ((error as { code?: string })?.code !== "permission-denied") {
        console.error("My leads listener error", error);
      }
    });

    return () => unsubscribe();
  }, [userDoc]);

  // Fetch unassigned leads
  useEffect(() => {
    if (!db || !userDoc) return;

    const q = query(
      collection(db, "leads"),
      where("assignedTo", "==", null),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const leads = snapshot.docs.map(d => ({ ...d.data(), leadId: d.id } as LeadDoc));
      setUnassignedLeads(leads.filter(l => isLeadDistributable(l)));
    }, (error) => {
      if ((error as { code?: string })?.code !== "permission-denied") {
        console.error("Unassigned leads listener error", error);
      }
    });

    return () => unsubscribe();
  }, [userDoc]);

  const allLeads = [...myLeads, ...unassignedLeads];

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedLeads(new Set(allLeads.map(l => l.leadId)));
    } else {
      setSelectedLeads(new Set());
    }
  };

  const handleToggleLead = (id: string) => {
    const next = new Set(selectedLeads);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedLeads(next);
  };

  const handleAssign = async () => {
    if (!userDoc || !targetAssignee || selectedLeads.size === 0) return;
    const reason = transferReason.trim();
    if (!reason) {
      alert("Transfer reason is required.");
      return;
    }
    
    setAssigning(true);
    try {
      const actor = buildLeadActor({
        uid: userDoc.uid,
        displayName: userDoc.displayName,
        email: userDoc.email,
        role: userDoc.role,
        orgRole: userDoc.orgRole,
        employeeId: userDoc.employeeId ?? null,
      });
      const leads = allLeads.filter((lead) => selectedLeads.has(lead.leadId));
      const result = await applyBulkLeadActions({
        leads,
        actor,
        assignTo: targetAssignee,
        status: "new",
        remarks: "Pending lead distribution",
        transferReason: reason,
      });
      if (result.writeFailures.length > 0 || result.sideEffectFailures.length > 0) {
        alert(
          [
            result.writeFailures.length > 0
              ? `${result.writeFailures.length} lead write failure${result.writeFailures.length === 1 ? "" : "s"}`
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
      
      // Clear selection
      setSelectedLeads(new Set());
      setTargetAssignee("");
      setTransferReason("");
      // alert("Leads assigned successfully");
    } catch (error) {
      console.error("Assignment error:", error);
      alert("Failed to assign leads");
    } finally {
      setAssigning(false);
    }
  };

  if (!userDoc || !canManageLeadAssignment(userDoc)) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <UserGroupIcon className="w-5 h-5 text-indigo-600" />
            Distribute Pending Leads
          </h2>
          <p className="text-sm text-slate-500">
            Reassign leads across your reporting tree, including a pullback to yourself.
          </p>
        </div>
        <div className="text-xs font-medium px-3 py-1 bg-slate-100 rounded-full text-slate-600">
          Available: {allLeads.length} Leads
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Source List */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center gap-3">
              <input 
                type="checkbox"
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                checked={allLeads.length > 0 && selectedLeads.size === allLeads.length}
                onChange={(e) => handleSelectAll(e.target.checked)}
              />
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Select All ({allLeads.length})
              </span>
            </div>
            <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-100 bg-white">
              {allLeads.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No leads available for distribution.
                </div>
              ) : (
                allLeads.map(lead => {
                  const leadId = lead.leadId;
                  const isUnassigned = !lead.assignedTo;
                  return (
                    <div key={leadId} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                      <input 
                        type="checkbox"
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                        checked={selectedLeads.has(leadId)}
                        onChange={() => handleToggleLead(leadId)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900 truncate">{toTitleCase(lead.name)}</span>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            lead.status === 'new' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {lead.status}
                          </span>
                          {isUnassigned && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                              Unassigned
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {lead.phone || "No Phone"} • {lead.email || "No Email"}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right: Action Panel */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Assign To
            </label>
            <select
              value={targetAssignee}
              onChange={(e) => setTargetAssignee(e.target.value)}
              className="w-full rounded-lg border-slate-200 text-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={assigneesLoading}
            >
              <option value="">Select Subordinate...</option>
              {assignees.map(u => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName || u.email} ({u.role || u.orgRole})
                </option>
              ))}
            </select>

            <label className="mt-4 block text-sm font-medium text-slate-700 mb-2">
              Transfer Reason
            </label>
            <textarea
              value={transferReason}
              onChange={(event) => setTransferReason(event.target.value)}
              rows={3}
              className="w-full rounded-lg border-slate-200 text-sm focus:border-indigo-500 focus:ring-indigo-500"
              placeholder="Why are these leads being redistributed?"
            />
            {!transferReason.trim() ? (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Transfer reason is mandatory.
              </div>
            ) : null}
            
            <div className="mt-4">
              <button
                onClick={handleAssign}
                disabled={!targetAssignee || selectedLeads.size === 0 || !transferReason.trim() || assigning}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {assigning ? (
                  <span>Assigning...</span>
                ) : (
                  <>
                    <span>Assign {selectedLeads.size} Leads</span>
                    <ArrowRightIcon className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
            
            <div className="mt-4 text-xs text-slate-500">
              <p className="flex items-center gap-1.5">
                <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
                Selected leads will be transferred immediately.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
