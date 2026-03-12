"use client";

import { Fragment, useEffect, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Payroll } from "@/lib/types/hr";
import { updatePayroll } from "@/app/actions/hr";
import { useAuth } from "@/components/auth/AuthProvider";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  payroll: Payroll | null;
  onSuccess: () => void;
};

export default function EditPayrollModal({ isOpen, onClose, payroll, onSuccess }: Props) {
  const { firebaseUser } = useAuth();
  const [baseSalary, setBaseSalary] = useState(0);
  const [bonus, setBonus] = useState(0);
  const [deductions, setDeductions] = useState(0);
  const [commissionPercentage, setCommissionPercentage] = useState(0);
  
  const [salesVolume, setSalesVolume] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchingSales, setFetchingSales] = useState(false);

  useEffect(() => {
    if (payroll) {
      setBaseSalary(payroll.baseSalary || 0);
      setBonus(payroll.bonus || 0);
      setDeductions(payroll.deductions || 0);
      setCommissionPercentage(payroll.commissionPercentage || 0);
      
      // Fetch Sales Volume
      fetchSalesVolume(payroll);
    }
  }, [payroll]);

  const fetchSalesVolume = async (p: Payroll) => {
    if (!db) return;
    setFetchingSales(true);
    try {
      const [year, month] = p.month.split("-").map(Number);
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59);

      const q = query(
        collection(db, "leads"),
        where("assignedTo", "==", p.uid),
        where("status", "==", "closed")
      );
      
      const snap = await getDocs(q);
      let vol = 0;
      snap.forEach(doc => {
        const d = doc.data();
        const ts = d.enrollmentDetails?.closedAt || d.closedAt || d.updatedAt || d.createdAt;
        let date: Date | null = null;
        
        if (ts && typeof ts.toDate === 'function') {
            date = ts.toDate();
        } else if (ts) {
            date = new Date(ts);
        }

        if (date && date >= start && date <= end) {
             const amt = Number(d.courseFees || d.amount || d.enrollmentDetails?.fee || 0);
             vol += amt;
        }
      });
      setSalesVolume(vol);
    } catch (err) {
      console.error("Error fetching sales volume:", err);
    } finally {
      setFetchingSales(false);
    }
  };

  const handleSave = async () => {
    if (!payroll || !firebaseUser) return;
    setLoading(true);
    
    try {
      const token = await firebaseUser.getIdToken();
      
      const updateArgs: {
        baseSalary: number;
        bonus: number;
        deductions: number;
        commissionPercentage: number;
      } = {
        baseSalary,
        bonus,
        deductions,
        commissionPercentage
      };
      
      const result = await updatePayroll(
        payroll.id,
        updateArgs,
        token,
        payroll.status === "PENDING_CREATION" ? {
            uid: payroll.uid,
            month: payroll.month
        } : undefined
      );
      
      if (result.success) {
        onSuccess();
        onClose();
      } else {
        alert("Error updating payroll: " + result.error);
      }
    } catch (err) {
      console.error(err);
      alert("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const calculatedIncentive = salesVolume * (commissionPercentage / 100);
  const calculatedNet = baseSalary + bonus + calculatedIncentive - deductions;

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6 w-full max-h-[90vh] overflow-y-auto">
                <div className="absolute right-0 top-0 hidden pr-4 pt-4 sm:block">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none"
                    onClick={onClose}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>
                
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-gray-900">
                      Edit Payroll: {payroll?.userDisplayName}
                    </Dialog.Title>
                    <div className="mt-4 space-y-4">
                      
                      {/* Base Salary */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Base Salary</label>
                        <div className="mt-1 relative rounded-md shadow-sm">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <span className="text-gray-500 sm:text-sm">₹</span>
                          </div>
                          <input
                            type="number"
                            value={baseSalary}
                            onChange={(e) => setBaseSalary(Number(e.target.value))}
                            className="block w-full rounded-md border-gray-300 pl-7 py-2 text-gray-900 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>
                      </div>

                      {/* Bonus */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Bonus</label>
                        <div className="mt-1 relative rounded-md shadow-sm">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <span className="text-gray-500 sm:text-sm">₹</span>
                          </div>
                          <input
                            type="number"
                            value={bonus}
                            onChange={(e) => setBonus(Number(e.target.value))}
                            className="block w-full rounded-md border-gray-300 pl-7 py-2 text-gray-900 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>
                      </div>

                      {/* Commission / Incentives */}
                      <div className="bg-slate-50 p-3 rounded-md border border-slate-200">
                        <label className="block text-sm font-medium text-gray-900 mb-2">Incentives (Performance Based)</label>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-500">Total Sales Volume</label>
                                <div className="text-sm font-medium">
                                    {fetchingSales ? "Loading..." : `₹${salesVolume.toLocaleString()}`}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500">Commission %</label>
                                <input
                                    type="number"
                                    value={commissionPercentage}
                                    onChange={(e) => setCommissionPercentage(Number(e.target.value))}
                                    className="mt-1 block w-full rounded-md border-gray-300 py-1 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                                    placeholder="0"
                                />
                            </div>
                        </div>
                        <div className="mt-2 text-right text-sm text-indigo-600 font-medium">
                            Calculated Incentive: ₹{calculatedIncentive.toLocaleString()}
                        </div>
                      </div>

                      {/* Deductions */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Deductions</label>
                        <div className="mt-1 relative rounded-md shadow-sm">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <span className="text-gray-500 sm:text-sm">₹</span>
                          </div>
                          <input
                            type="number"
                            value={deductions}
                            onChange={(e) => setDeductions(Number(e.target.value))}
                            className="block w-full rounded-md border-gray-300 pl-7 py-2 text-gray-900 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>
                        <p className="mt-1 text-xs text-gray-500">Includes lates and manual deductions.</p>
                      </div>

                      {/* Net Salary Preview */}
                      <div className="mt-4 pt-4 border-t border-gray-200 flex justify-between items-center">
                        <span className="text-base font-semibold text-gray-900">Net Salary</span>
                        <span className="text-xl font-bold text-indigo-600">₹{Math.round(calculatedNet).toLocaleString()}</span>
                      </div>

                    </div>
                  </div>
                </div>
                
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    disabled={loading}
                    className="inline-flex w-full justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 sm:ml-3 sm:w-auto disabled:opacity-50"
                    onClick={handleSave}
                  >
                    {loading ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
