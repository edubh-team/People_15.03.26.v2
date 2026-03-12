"use client";

import { Fragment, useState } from "react";
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon, EyeIcon } from "@heroicons/react/24/outline";
import { LeadDoc } from "@/lib/types/crm";
import LeadDetailPanel from "@/components/leads/LeadDetailPanel";
import { UserDoc } from "@/lib/types/user";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  universityName: string;
  leads: LeadDoc[];
  currentUser: UserDoc;
};

export default function UniversityLeadsModal({ isOpen, onClose, universityName, leads, currentUser }: Props) {
  const [selectedLead, setSelectedLead] = useState<LeadDoc | null>(null);

  const handleLeadClick = (lead: LeadDoc) => {
    setSelectedLead(lead);
  };

  const closeDetail = () => {
    setSelectedLead(null);
  };

  return (
    <>
      <Transition show={isOpen} as={Fragment}>
        <Dialog onClose={onClose} className="relative z-[100]" style={{ zIndex: 100 }}>
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
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-4xl max-h-[90vh] flex flex-col transform overflow-hidden rounded-2xl bg-white shadow-xl transition-all">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                  <div>
                    <DialogTitle className="text-lg font-bold text-slate-900">
                      {universityName}
                    </DialogTitle>
                    <p className="text-sm text-slate-500">{leads.length} enrolled students</p>
                  </div>
                  <button onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-500">
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-0">
                  <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Student Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Course</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Fee</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {leads.map((lead) => {
                        // Use casting to access potential loose fields like 'amount' or 'fee' if they exist but aren't in type
                        const rawFee = lead.enrollmentDetails?.fee ?? lead.courseFees ?? (lead as any).amount ?? (lead as any).fee ?? 0;
                        const date = lead.enrollmentDetails?.closedAt ?? lead.closedAt ?? lead.updatedAt;
                        
                        let dateStr = "—";
                        if (date) {
                            if (typeof date === 'object' && 'toDate' in date) {
                                dateStr = (date as any).toDate().toLocaleDateString();
                            } else if (typeof date === 'object' && 'seconds' in date) {
                                dateStr = new Date((date as any).seconds * 1000).toLocaleDateString();
                            } else if (date instanceof Date) {
                                dateStr = date.toLocaleDateString();
                            } else if (typeof date === 'string') {
                                dateStr = new Date(date).toLocaleDateString();
                            }
                        }

                        return (
                          <tr key={lead.leadId} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                              {lead.name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                              {lead.enrollmentDetails?.course || lead.targetDegree || "—"}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                              {typeof rawFee === 'number' ? `₹${rawFee.toLocaleString()}` : rawFee}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                              {dateStr}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <button
                                onClick={() => handleLeadClick(lead)}
                                className="text-indigo-600 hover:text-indigo-900 inline-flex items-center gap-1"
                              >
                                <EyeIcon className="h-4 w-4" />
                                Details
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>

      {selectedLead && (
        <LeadDetailPanel
          isOpen={!!selectedLead}
          onClose={closeDetail}
          lead={selectedLead}
          currentUser={currentUser}
          userRole={currentUser.orgRole || undefined}
        />
      )}
    </>
  );
}
