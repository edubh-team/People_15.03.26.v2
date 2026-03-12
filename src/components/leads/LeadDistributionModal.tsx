"use client";

import { useState, useEffect, Fragment, useMemo } from "react";
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon, UserGroupIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { LeadDoc } from "@/lib/types/crm";
import { useAuth } from "@/components/auth/AuthProvider";
import { getCrmRoutingSuggestion } from "@/lib/crm/automation-client";
import { useScopedUsers } from "@/lib/hooks/useScopedUsers";
import {
  canManageLeadAssignment,
  getAssignableLeadOwners,
} from "@/lib/crm/access";
import { applyBulkLeadActions } from "@/lib/crm/bulk-actions";
import { buildLeadActor } from "@/lib/crm/timeline";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  leads: LeadDoc[];
  onSuccess?: () => void;
};

export default function LeadDistributionModal({ isOpen, onClose, leads, onSuccess }: Props) {
  const { userDoc } = useAuth();
  const { users: scopedUsers, loading: assigneesLoading } = useScopedUsers(userDoc, {
    includeCurrentUser: true,
    includeInactive: false,
  });
  const assignees = useMemo(
    () => getAssignableLeadOwners(userDoc, scopedUsers),
    [scopedUsers, userDoc],
  );
  const [targetAssignee, setTargetAssignee] = useState("");
  const [recommendedAssignee, setRecommendedAssignee] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [transferReason, setTransferReason] = useState("");

  // Reset state when modal opens/closes or leads change
  useEffect(() => {
    if (!isOpen) {
      setTargetAssignee("");
      setRecommendedAssignee("");
      setAssigning(false);
      setTransferReason("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !userDoc || assigneesLoading || assignees.length === 0) return;

    let active = true;
    getCrmRoutingSuggestion(userDoc.uid)
      .then((uid) => {
        if (!active || !uid) return;
        if (!assignees.some((user) => user.uid === uid)) return;
        setRecommendedAssignee(uid);
        setTargetAssignee((previous) => previous || uid);
      })
      .catch((error) => {
        console.error("Failed to load routing recommendation", error);
      });

    return () => {
      active = false;
    };
  }, [assignees, assigneesLoading, isOpen, userDoc]);

  if (!userDoc || !canManageLeadAssignment(userDoc)) return null;

  const handleAssign = async () => {
    if (!userDoc || !targetAssignee || leads.length === 0) return;
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

      const result = await applyBulkLeadActions({
        leads,
        actor,
        assignTo: targetAssignee,
        status: "new",
        remarks: `Lead distribution for ${leads.length} selected lead${leads.length === 1 ? "" : "s"}`,
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

      onSuccess?.();
      onClose();
    } catch (error) {
      console.error("Assignment error:", error);
      alert("Failed to assign leads");
    } finally {
      setAssigning(false);
    }
  };

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <DialogPanel className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl transition-all">
              <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between bg-slate-50/50">
                <DialogTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <UserGroupIcon className="w-5 h-5 text-indigo-600" />
                  Re-assign Lead{leads.length > 1 ? "s" : ""}
                </DialogTitle>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-500">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="text-sm text-slate-600">
                  You are re-assigning <span className="font-semibold text-slate-900">{leads.length} lead{leads.length > 1 ? "s" : ""}</span>. 
                  The status will be reset to <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">New</span> for the assignee, and you can pull the lead back to yourself before redistributing it.
                </div>

                <div>
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
                  {recommendedAssignee ? (
                    <div className="mt-2 text-xs text-indigo-600">
                      Recommended by availability and quota balancing.
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Transfer Reason
                  </label>
                  <textarea
                    value={transferReason}
                    onChange={(event) => setTransferReason(event.target.value)}
                    rows={3}
                    className="w-full rounded-lg border-slate-200 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                    placeholder="Why are these leads being moved?"
                  />
                  {!transferReason.trim() ? (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Transfer reason is mandatory.
                    </div>
                  ) : null}
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAssign}
                    disabled={!targetAssignee || !transferReason.trim() || assigning}
                    className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {assigning ? (
                      <span>Assigning...</span>
                    ) : (
                      <>
                        <span>Confirm Assignment</span>
                        <ArrowRightIcon className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
