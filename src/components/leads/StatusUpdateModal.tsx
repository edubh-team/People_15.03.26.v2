"use client";

import { useState, Fragment, useEffect } from "react";
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon, CalendarIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { LeadDoc } from "@/lib/types/crm";
import { LEAD_STATUS_OPTIONS, LeadStatusValue } from "@/constants/leadStatus";
import { updateLeadStatusInDb, updateLeadClosure } from "@/lib/firebase/leads";
import {
  isFollowUpStatus,
  isPaymentFollowUpStatus,
  normalizeLeadStatus,
} from "@/lib/leads/status";
import ClosureForm, { ClosureFormData } from "./ClosureForm";
import { toTitleCase } from "@/lib/utils/stringUtils";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  lead: LeadDoc | null;
  onSuccess?: () => void;
  currentUserUid: string;
};

function toModalStatusValue(status: LeadDoc["status"]): LeadStatusValue {
  const normalized = normalizeLeadStatus(status);
  return normalized === "closed" ? "converted" : normalized;
}

export default function StatusUpdateModal({ isOpen, onClose, lead, onSuccess, currentUserUid }: Props) {
  const [status, setStatus] = useState<LeadStatusValue>("new");
  const [remarks, setRemarks] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal opens with a new lead
  useEffect(() => {
    if (isOpen && lead) {
      setStatus(toModalStatusValue(lead.status));
      setRemarks("");
      setFollowUpDate("");
    }
  }, [isOpen, lead]);

  const handleClosureSubmit = async (data: ClosureFormData) => {
    if (!lead || !currentUserUid) return;

    setIsSubmitting(true);
    try {
      await updateLeadClosure(
        lead.leadId,
        {
          ...data,
          utrNumber: data.emiDetails,
        },
        currentUserUid
      );
      
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error("Failed to close lead:", error);
      alert("Failed to close lead. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead || !currentUserUid) return;

    // Validation
    if (isFollowUpStatus(status) && !followUpDate) {
      alert("Please select a follow-up date.");
      return;
    }
    if ((status === "not_interested" || isFollowUpStatus(status)) && !remarks.trim()) {
      alert("Remarks are mandatory for this status.");
      return;
    }

    setIsSubmitting(true);
    try {
      await updateLeadStatusInDb(
        lead.leadId,
        status,
        remarks,
        currentUserUid,
        followUpDate ? new Date(followUpDate) : null
      );
      
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error("Failed to update status:", error);
      alert("Failed to update status. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

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
                  Update Status: {toTitleCase(lead.name)}
                </DialogTitle>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-500">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {/* Status Dropdown */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    New Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => {
                      console.log("Status changed to:", e.target.value);
                      setStatus(e.target.value as LeadStatusValue);
                    }}
                    className="w-full rounded-lg border-slate-200 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                  >
                    {LEAD_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {isPaymentFollowUpStatus(status) ? (
                  <div className="animate-in fade-in zoom-in-95 duration-200">
                    <ClosureForm
                      onSubmit={handleClosureSubmit}
                      onCancel={onClose}
                      isSubmitting={isSubmitting}
                    />
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Conditional Follow Up Date */}
                    {isFollowUpStatus(status) && (
                      <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Next Follow Up Date <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                          <input
                            type="datetime-local"
                            required
                            value={followUpDate}
                            onChange={(e) => setFollowUpDate(e.target.value)}
                            className="w-full rounded-lg border-slate-200 text-sm focus:border-indigo-500 focus:ring-indigo-500 pl-10"
                          />
                          <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        </div>
                      </div>
                    )}

                    {/* Remarks Field */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Notes / Remarks {(status === "not_interested" || isFollowUpStatus(status)) && <span className="text-red-500">*</span>}
                      </label>
                      <textarea
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        required={status === "not_interested" || isFollowUpStatus(status)}
                        rows={4}
                        className="w-full rounded-lg border-slate-200 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                        placeholder="Add details about the interaction..."
                      />
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
                        type="submit"
                        disabled={isSubmitting}
                        className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSubmitting ? (
                          <span>Saving...</span>
                        ) : (
                          <>
                            <span>Save Update</span>
                            <ArrowRightIcon className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
