"use client";

import { Fragment } from "react";
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import { 
  XMarkIcon, 
  PhoneIcon, 
  EnvelopeIcon, 
  AcademicCapIcon, 
  PencilSquareIcon,
  UserCircleIcon
} from "@heroicons/react/24/outline";
import { LeadDoc } from "@/lib/types/crm";
import { Timestamp } from "firebase/firestore";
import { toTitleCase } from "@/lib/utils/stringUtils";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  lead: LeadDoc | null;
  onUpdateStatus?: (lead: LeadDoc) => void;
};

export default function LeadDetailModal({ isOpen, onClose, lead, onUpdateStatus }: Props) {
  if (!lead) return null;

  const formatDate = (date: unknown) => {
    if (!date) return "—";
    if (date instanceof Timestamp) return date.toDate().toLocaleString();
    if (typeof date === "string") return new Date(date).toLocaleString();
    // Handle serialized dates if any
    if (date && typeof date === 'object' && 'seconds' in date) {
      return new Date((date as { seconds: number }).seconds * 1000).toLocaleString();
    }
    return "Invalid Date";
  };

  return (
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

        <div className="fixed inset-0 flex items-center justify-end overflow-hidden">
          <TransitionChild
            as={Fragment}
            enter="transform transition ease-in-out duration-300 sm:duration-500"
            enterFrom="translate-x-full"
            enterTo="translate-x-0"
            leave="transform transition ease-in-out duration-300 sm:duration-500"
            leaveFrom="translate-x-0"
            leaveTo="translate-x-full"
          >
            <DialogPanel className="pointer-events-auto w-screen max-w-md h-full bg-white shadow-2xl flex flex-col">
              {/* Header */}
              <div className="flex-shrink-0 border-b border-slate-100 bg-slate-50/50 px-6 py-4 flex items-start justify-between">
                <div>
                  <DialogTitle className="text-lg font-bold text-slate-900">
                    Lead Details
                  </DialogTitle>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{toTitleCase(lead.name)}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize
                      ${lead.status === 'new' ? 'bg-blue-50 text-blue-700' : 
                        lead.status === 'hot' ? 'bg-red-50 text-red-700' :
                        lead.status === 'closed' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-700'}`}>
                      {lead.status}
                    </span>
                  </div>
                </div>
                <button onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-500">
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                
                {/* Contact Info */}
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Contact Information</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 text-sm">
                      <PhoneIcon className="h-5 w-5 text-slate-400" />
                      {lead.phone ? (
                        <a href={`tel:${lead.phone}`} className="text-indigo-600 hover:underline">{lead.phone}</a>
                      ) : <span className="text-slate-400">No phone provided</span>}
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <EnvelopeIcon className="h-5 w-5 text-slate-400" />
                      {lead.email ? (
                        <a href={`mailto:${lead.email}`} className="text-indigo-600 hover:underline">{lead.email}</a>
                      ) : <span className="text-slate-400">No email provided</span>}
                    </div>
                  </div>
                </section>

                {/* Academic Info */}
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Academic Interest</h3>
                  <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <AcademicCapIcon className="h-5 w-5 text-slate-400 mt-0.5" />
                      <div>
                        <div className="text-xs text-slate-500">Target Program (University)</div>
                        <div className="text-sm font-medium text-slate-900">
                          {lead.enrollmentDetails?.university || lead.targetUniversity || "—"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="h-5 w-5 flex items-center justify-center">
                        <span className="block h-1.5 w-1.5 rounded-full bg-slate-400" />
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Course / Degree</div>
                        <div className="text-sm font-medium text-slate-900">
                          {lead.enrollmentDetails?.course || lead.targetDegree || "—"}
                        </div>
                      </div>
                    </div>

                    {(lead.enrollmentDetails?.university || lead.enrollmentDetails?.course) && (
                      <div className="flex items-start gap-3 pt-2 border-t border-slate-100">
                        <div className="h-5 w-5 flex items-center justify-center">
                          <span className="text-slate-400 font-bold">₹</span>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Course Fees</div>
                          <div className="text-sm font-medium text-slate-900">
                            {lead.enrollmentDetails?.fee 
                              ? `₹${lead.enrollmentDetails.fee.toLocaleString()}` 
                              : (lead.courseFees ? `₹${lead.courseFees.toLocaleString()}` : "—")
                            }
                          </div>
                        </div>
                      </div>
                    )}

                    {(lead.enrollmentDetails?.university || lead.enrollmentDetails?.course) && (
                      <div className="flex items-start gap-3">
                        <UserCircleIcon className="h-5 w-5 text-indigo-500 mt-0.5" />
                        <div>
                          <div className="text-xs text-slate-500">Punched By</div>
                          <div className="text-sm font-medium text-indigo-700">
                            {lead.createdBy?.name || lead.closedBy?.name || lead.assignedTo || "—"}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* System Info */}
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">System Metadata</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="p-3 rounded-lg border border-slate-100">
                      <div className="text-xs text-slate-500 mb-1">Lead ID</div>
                      <div className="font-mono text-slate-700 select-all">{lead.leadId}</div>
                    </div>
                    <div className="p-3 rounded-lg border border-slate-100">
                      <div className="text-xs text-slate-500 mb-1">Created At</div>
                      <div className="text-slate-700">{formatDate(lead.createdAt)}</div>
                    </div>
                    <div className="p-3 rounded-lg border border-slate-100 col-span-2">
                      <div className="flex items-center gap-2 mb-1">
                        <UserCircleIcon className="h-4 w-4 text-slate-400" />
                        <div className="text-xs text-slate-500">Assigned To</div>
                      </div>
                      <div className="text-slate-900 font-medium">
                        {lead.assignedTo ? (
                          <span className="flex items-center gap-2">
                            {lead.assignedTo}
                            {!!lead.assignedAt && (
                              <span className="text-xs font-normal text-slate-500">
                                ({formatDate(lead.assignedAt)})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-xs">Unassigned</span>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Activity Log */}
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Activity History</h3>
                  <div className="relative border-l border-slate-200 ml-2 space-y-6">
                    {(lead.activityHistory || []).length === 0 ? (
                      <div className="pl-6 text-sm text-slate-400 italic">No activity recorded</div>
                    ) : (
                      [...lead.activityHistory].reverse().map((activity, idx) => (
                        <div key={idx} className="relative pl-6">
                          <div className="absolute -left-1.5 top-1 h-3 w-3 rounded-full border-2 border-white bg-indigo-500 ring-1 ring-slate-200" />
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase text-slate-700">{activity.type}</span>
                              <span className="text-[10px] text-slate-400">{formatDate(activity.at)}</span>
                            </div>
                            {activity.note && (
                              <p className="text-sm text-slate-600 bg-slate-50 p-2 rounded-lg mt-1">
                                {activity.note}
                              </p>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

              </div>
              
              {/* Footer Actions */}
              <div className="border-t border-slate-100 p-4 bg-slate-50/50 flex flex-col sm:flex-row-reverse gap-3">
                 {onUpdateStatus && (
                   <button
                     type="button"
                     onClick={() => onUpdateStatus(lead)}
                     className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 sm:w-auto"
                   >
                     <PencilSquareIcon className="h-4 w-4" />
                     Update Status
                   </button>
                 )}
                 <button 
                   type="button"
                   onClick={onClose}
                   className="inline-flex w-full items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 sm:w-auto"
                 >
                   Close
                 </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
