"use client";

import { useState, Fragment } from "react";
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { doc, updateDoc, arrayUnion, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { LeadDoc, LeadStatus } from "@/lib/types/crm";
import { useAuth } from "@/components/auth/AuthProvider";
import { logAudit } from "@/lib/audit";
import {
  getLeadStatusLabel,
  normalizeLeadStatus,
  PAYMENT_FOLLOW_UP_STATUS,
  toStoredLeadStatus,
} from "@/lib/leads/status";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  lead: LeadDoc | null;
  onSuccess?: () => void;
};

export default function LeadDispositionModal({ isOpen, onClose, lead, onSuccess }: Props) {
  const { userDoc } = useAuth();
  const [status, setStatus] = useState<LeadStatus>("followup");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!db || !lead) return;

    setIsSubmitting(true);
    try {
      const ref = doc(db, "leads", lead.leadId);
      const nextStatus = toStoredLeadStatus(status);
      
      await updateDoc(ref, {
        status: nextStatus,
        updatedAt: serverTimestamp(),
        activityHistory: arrayUnion({
          type: "contacted",
          at: new Date(), // Using client date for immediate UI, serverTimestamp in real app if strict
          note: note.trim()
        })
      });

      // Log to Audit Trail
      await logAudit(
        "LEAD_STATUS_CHANGE",
        `Changed status from ${getLeadStatusLabel(lead.status)} to ${getLeadStatusLabel(nextStatus)}`,
        userDoc?.uid || "unknown",
        {
          leadId: lead.leadId,
          leadName: lead.name,
          oldStatus: lead.status,
          newStatus: nextStatus,
          note: note.trim()
        }
      );

      onSuccess?.();
      onClose();
      setNote("");
      setStatus("followup"); // Reset to default
    } catch (error) {
      console.error("Failed to update lead", error);
      alert("Failed to update lead status");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!lead) return null;

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
                <DialogTitle className="text-lg font-semibold text-slate-900">
                  Log Interaction
                </DialogTitle>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-500">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Lead Name
                  </label>
                  <div className="text-slate-900 font-medium">{lead.name}</div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    New Status
                  </label>
                  <select
                    value={normalizeLeadStatus(status)}
                    onChange={(e) => setStatus(e.target.value as LeadStatus)}
                    className="w-full rounded-lg border-slate-200 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                  >
                    <option value="interested">Hot (Interested)</option>
                    <option value="followup">Warm (Needs Nurturing)</option>
                    <option value="followup">Follow Up</option>
                    <option value={PAYMENT_FOLLOW_UP_STATUS}>Payment Follow Up</option>
                    <option value="not_interested">Cold (Not Interested)</option>
                    <option value="closed">Closed / Converted</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Moving away from &quot;New&quot; will remove it from the New Leads queue.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Call Note / Summary
                  </label>
                  <textarea
                    required
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    className="w-full rounded-lg border-slate-200 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                    placeholder="Discussed requirements..."
                  />
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm disabled:opacity-50"
                  >
                    {isSubmitting ? "Saving..." : "Update Status"}
                  </button>
                </div>
              </form>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
