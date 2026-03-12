"use client";

import { useState, Fragment, useMemo, useRef } from "react";
import { Dialog, Transition, TransitionChild, DialogPanel, DialogTitle, Listbox, ListboxButton, ListboxOptions, ListboxOption } from "@headlessui/react";
import { XMarkIcon, PaperClipIcon, DocumentIcon, CheckIcon, ChevronUpDownIcon } from "@heroicons/react/24/outline";
import { useApplyForLeave } from "@/lib/hooks/useAttendance";
import { useAuth } from "@/components/auth/AuthProvider";
import { LeaveType } from "@/lib/types/attendance";
import { calculateLeaveRangeBreakdown } from "@/lib/attendance/leave-policy";
import { getEffectiveReportsToUid } from "@/lib/sales/hierarchy";
import { storage } from "@/lib/firebase/client";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

const LEAVE_TYPES: { id: LeaveType; label: string }[] = [
  { id: "casual", label: "Casual Leave" },
  { id: "medical", label: "Medical Leave" },
  { id: "unpaid", label: "Unpaid Leave" },
];

export default function LeaveApplicationModal({ isOpen, onClose }: Props) {
  const { firebaseUser, userDoc } = useAuth();
  const applyForLeave = useApplyForLeave();
  
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [includeSaturdayAsLeave, setIncludeSaturdayAsLeave] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reportingManagerId = userDoc ? getEffectiveReportsToUid(userDoc) : null;

  const leaveBreakdownPreview = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate) return null;
    return calculateLeaveRangeBreakdown(startDate, endDate, {
      includeSaturdayAsLeave,
    });
  }, [startDate, endDate, includeSaturdayAsLeave]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      // Basic validation: max 5MB
      if (selectedFile.size > 5 * 1024 * 1024) {
        setError("File size must be less than 5MB");
        return;
      }
      setFile(selectedFile);
      setError("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setError("");

    if (!startDate || !endDate || !reason.trim()) {
      setError("All fields are required.");
      return;
    }

    if (endDate < startDate) {
      setError("End date cannot be before start date.");
      return;
    }

    if (leaveType === "medical" && !file) {
      setError("Supporting document is required for Medical Leave.");
      return;
    }

    try {
      let attachmentUrl = undefined;

      if (file && storage) {
        setIsUploading(true);
        // eslint-disable-next-line react-hooks/purity
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9.]/g, "_");
        const storageRef = ref(storage, `leave_documents/${firebaseUser.uid}/${timestamp}_${safeName}`);
        await uploadBytes(storageRef, file);
        attachmentUrl = await getDownloadURL(storageRef);
        setIsUploading(false);
      } else if (leaveType === "medical" && !storage) {
          setError("Storage service unavailable. Please try again later.");
          return;
      }

      await applyForLeave.mutateAsync({
        uid: firebaseUser.uid,
        startDateKey: startDate,
        endDateKey: endDate,
        reason,
        type: leaveType,
        attachmentUrl,
        assignedHR: userDoc?.assignedHR,
        reportingManagerId,
        requesterRole: userDoc?.orgRole ?? userDoc?.role ?? null,
        includeSaturdayAsLeave,
      });

      handleClose();
    } catch (err) {
      setIsUploading(false);
      setError(err instanceof Error ? err.message : "Failed to apply for leave.");
    }
  };

  const handleClose = () => {
    onClose();
    // Reset form after transition might be better, but immediate is fine for now
    setTimeout(() => {
      setStartDate("");
      setEndDate("");
      setReason("");
      setLeaveType("casual");
      setIncludeSaturdayAsLeave(false);
      setFile(null);
      setError("");
    }, 300);
  };

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" />
        </TransitionChild>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel className="relative w-full transform overflow-hidden rounded-2xl bg-white text-left shadow-2xl transition-all sm:my-8 sm:max-w-lg">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 sm:px-6">
                  <div className="flex items-center justify-between">
                    <DialogTitle as="h3" className="text-lg font-semibold leading-6 text-slate-900">
                      Apply for Leave
                    </DialogTitle>
                    <button
                      type="button"
                      className="rounded-full bg-white p-1 text-slate-400 hover:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                      onClick={handleClose}
                    >
                      <span className="sr-only">Close</span>
                      <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="px-4 py-5 sm:p-6">
                  <form onSubmit={handleSubmit} className="space-y-5">
                    {error && (
                      <div className="rounded-md bg-rose-50 p-3 text-sm font-medium text-rose-700 ring-1 ring-inset ring-rose-600/10">
                        {error}
                      </div>
                    )}

                    <div>
                      <Listbox value={leaveType} onChange={setLeaveType}>
                        {({ open }) => (
                          <>
                            <label className="block text-sm font-medium text-slate-700">Leave Type</label>
                            <div className="relative mt-1">
                              <ListboxButton className="relative w-full cursor-default rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-left shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm">
                                <span className="block truncate">{LEAVE_TYPES.find((t) => t.id === leaveType)?.label}</span>
                                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                                  <ChevronUpDownIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                                </span>
                              </ListboxButton>
                              <Transition
                                show={open}
                                as={Fragment}
                                leave="transition ease-in duration-100"
                                leaveFrom="opacity-100"
                                leaveTo="opacity-0"
                              >
                                <ListboxOptions className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
                                  {LEAVE_TYPES.map((type) => (
                                    <ListboxOption
                                      key={type.id}
                                      className={({ active }) =>
                                        `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                          active ? 'bg-indigo-100 text-indigo-900' : 'text-slate-900'
                                        }`
                                      }
                                      value={type.id}
                                    >
                                      {({ selected }) => (
                                        <>
                                          <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                            {type.label}
                                          </span>
                                          {selected ? (
                                            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-indigo-600">
                                              <CheckIcon className="h-5 w-5" aria-hidden="true" />
                                            </span>
                                          ) : null}
                                        </>
                                      )}
                                    </ListboxOption>
                                  ))}
                                </ListboxOptions>
                              </Transition>
                            </div>
                          </>
                        )}
                      </Listbox>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700">Start Date</label>
                        <div className="relative mt-1">
                          <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            onClick={(e) => e.currentTarget.showPicker()}
                            className="block w-full cursor-pointer rounded-lg border-slate-300 py-2.5 pl-3 pr-10 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700">End Date</label>
                        <div className="relative mt-1">
                          <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            onClick={(e) => e.currentTarget.showPicker()}
                            className="block w-full cursor-pointer rounded-lg border-slate-300 py-2.5 pl-3 pr-10 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            required
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700">Reason</label>
                      <div className="mt-1">
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          rows={4}
                          className="block w-full rounded-lg border-slate-300 py-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          placeholder="Please provide a detailed reason for your leave request..."
                          required
                        />
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-slate-800">Weekend Policy</div>
                          <p className="mt-1 text-xs text-slate-600">
                            Sunday is mandatory weekly off and never counted as leave. Saturday is optional weekly off.
                          </p>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={includeSaturdayAsLeave}
                            onChange={(event) => setIncludeSaturdayAsLeave(event.target.checked)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          Count Saturdays as leave
                        </label>
                      </div>
                      {leaveBreakdownPreview ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
                          <div className="rounded-md bg-white px-2 py-1 ring-1 ring-slate-200">
                            Total days: <span className="font-semibold text-slate-900">{leaveBreakdownPreview.totalCalendarDays}</span>
                          </div>
                          <div className="rounded-md bg-white px-2 py-1 ring-1 ring-slate-200">
                            Chargeable: <span className="font-semibold text-slate-900">{leaveBreakdownPreview.chargeableLeaveDays}</span>
                          </div>
                          <div className="rounded-md bg-white px-2 py-1 ring-1 ring-slate-200">
                            Sat excluded: <span className="font-semibold text-slate-900">{leaveBreakdownPreview.saturdayExcludedDays}</span>
                          </div>
                          <div className="rounded-md bg-white px-2 py-1 ring-1 ring-slate-200">
                            Sun excluded: <span className="font-semibold text-slate-900">{leaveBreakdownPreview.sundayExcludedDays}</span>
                          </div>
                        </div>
                      ) : null}
                      <p className="mt-2 text-[11px] text-slate-500">
                        Monthly allowance is 14 chargeable leave days. Extra chargeable days are marked for payroll deduction.
                      </p>
                    </div>

                    {leaveType === "medical" && (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
                        <label className="block text-sm font-medium text-slate-700">
                          Supporting Documents <span className="text-rose-500">*</span>
                        </label>
                        <div className="mt-2 flex items-center gap-4">
                           <button
                             type="button"
                             onClick={() => fileInputRef.current?.click()}
                             className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
                           >
                             <PaperClipIcon className="h-4 w-4 text-slate-500" />
                             Choose File
                           </button>
                           <input 
                             type="file" 
                             ref={fileInputRef} 
                             onChange={handleFileChange} 
                             className="hidden" 
                             accept="image/*,.pdf"
                           />
                           {file ? (
                             <div className="flex items-center gap-2 text-sm text-indigo-600">
                               <DocumentIcon className="h-4 w-4" />
                               <span className="truncate max-w-[150px]">{file.name}</span>
                               <button 
                                 type="button" 
                                 onClick={() => setFile(null)}
                                 className="ml-1 text-slate-400 hover:text-rose-500"
                               >
                                 <XMarkIcon className="h-4 w-4" />
                               </button>
                             </div>
                           ) : (
                             <span className="text-xs text-slate-500">
                               Max 5MB (PDF or Image)
                             </span>
                           )}
                        </div>
                      </div>
                    )}
                  </form>
                </div>

                <div className="bg-slate-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
                  <button
                    type="submit"
                    onClick={handleSubmit}
                    disabled={applyForLeave.isPending || isUploading}
                    className="inline-flex w-full justify-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 sm:ml-3 sm:w-auto"
                  >
                    {isUploading ? "Uploading..." : applyForLeave.isPending ? "Applying..." : "Submit Application"}
                  </button>
                  <button
                    type="button"
                    className="mt-3 inline-flex w-full justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 sm:mt-0 sm:w-auto"
                    onClick={handleClose}
                  >
                    Cancel
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
