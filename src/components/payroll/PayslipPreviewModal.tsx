"use client";

import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import { EyeIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Fragment } from "react";
import DownloadPayslipButton from "@/components/hr/DownloadPayslipButton";
import PayslipPreviewCard from "@/components/payroll/PayslipPreviewCard";
import type { Payroll } from "@/lib/types/hr";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  payroll: Payroll | null;
  employee:
    | {
        name: string;
        employeeId: string;
        designation?: string | null;
        department?: string | null;
      }
    | null;
  onError?: (message: string) => void;
};

export default function PayslipPreviewModal({ isOpen, onClose, payroll, employee, onError }: Props) {
  if (!payroll || !employee) return null;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-950/55 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 lg:p-8">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-4 scale-[0.98]"
              enterTo="opacity-100 translate-y-0 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0 scale-100"
              leaveTo="opacity-0 translate-y-4 scale-[0.98]"
            >
              <DialogPanel className="w-full max-w-6xl overflow-hidden rounded-[28px] bg-slate-100 shadow-2xl ring-1 ring-slate-900/10">
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-indigo-50 p-2 text-indigo-600">
                      <EyeIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <DialogTitle className="text-lg font-semibold text-slate-950">Preview Payslip</DialogTitle>
                      <div className="text-sm text-slate-500">
                        Verify the final corporate layout before downloading.
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="max-h-[78vh] overflow-y-auto bg-slate-100 p-4 sm:p-6">
                  <PayslipPreviewCard payroll={payroll} employee={employee} />
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Close
                  </button>
                  <DownloadPayslipButton
                    payroll={payroll}
                    employee={employee}
                    onError={onError}
                    variant="button"
                  />
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
