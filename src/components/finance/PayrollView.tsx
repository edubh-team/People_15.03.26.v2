"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase/client";
import { collection, query, where, onSnapshot, updateDoc, doc, Timestamp } from "firebase/firestore";
import { Payroll } from "@/lib/types/hr";
import { format } from "date-fns";
import { ArrowDownTrayIcon, CheckCircleIcon, XCircleIcon, BanknotesIcon } from "@heroicons/react/24/outline";
import dynamic from "next/dynamic";
import { RoleBadge } from "@/components/RoleBadge";

// Dynamic import for PDF generation to avoid SSR issues
const DownloadPayslipButton = dynamic(
  () => import("@/components/hr/DownloadPayslipButton"),
  { ssr: false }
);

export default function PayrollView() {
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), "yyyy-MM"));
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db) return;

    setLoading(true);
    // Query payrolls for selected month
    const q = query(
        collection(db, "payroll"), 
        where("month", "==", selectedMonth)
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Payroll));
      setPayrolls(data);
      setLoading(false);
    });

    return () => unsub();
  }, [selectedMonth]);

  const markAsPaid = async (payrollId: string) => {
    if (!db) {
        alert("Database not initialized");
        return;
    }
    if (!confirm("Are you sure you want to mark this payroll as PAID?")) return;
    try {
        await updateDoc(doc(db, "payroll", payrollId), {
            status: "PAID",
            paidAt: Timestamp.now()
        });
    } catch (e) {
        console.error("Failed to update status", e);
        alert("Failed to update status");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header & Filters */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Organization Payroll</h2>
          <p className="text-sm text-slate-500">View and manage employee payslips</p>
        </div>
        
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-600">Period:</label>
          <input 
            type="month" 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
          />
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-sm text-slate-500 font-medium">Total Payroll</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
                ₹{payrolls.reduce((sum, p) => sum + (p.netSalary || 0), 0).toLocaleString()}
            </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-sm text-slate-500 font-medium">Pending Disbursal</div>
            <div className="text-2xl font-bold text-orange-600 mt-1">
                ₹{payrolls.filter(p => p.status !== "PAID").reduce((sum, p) => sum + (p.netSalary || 0), 0).toLocaleString()}
            </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-sm text-slate-500 font-medium">Generated Slips</div>
            <div className="text-2xl font-bold text-indigo-600 mt-1">
                {payrolls.length}
            </div>
        </div>
      </div>

      {/* Payroll List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
            <div className="p-8 text-center text-slate-500">Loading payroll data...</div>
        ) : payrolls.length === 0 ? (
            <div className="p-12 text-center">
                <div className="mx-auto w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                    <BanknotesIcon className="w-6 h-6 text-slate-400" />
                </div>
                <h3 className="text-slate-900 font-medium">No Payroll Records</h3>
                <p className="text-slate-500 text-sm mt-1">No payroll data found for {selectedMonth}</p>
            </div>
        ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                            <th className="px-6 py-4 font-semibold">Employee</th>
                            <th className="px-6 py-4 font-semibold text-right">Base Salary</th>
                            <th className="px-6 py-4 font-semibold text-right">Incentives</th>
                            <th className="px-6 py-4 font-semibold text-right">Deductions</th>
                            <th className="px-6 py-4 font-semibold text-right">Net Pay</th>
                            <th className="px-6 py-4 font-semibold text-center">Status</th>
                            <th className="px-6 py-4 font-semibold text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {payrolls.map((payroll) => (
                            <tr key={payroll.id} className="hover:bg-slate-50 transition-colors group">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-9 w-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs">
                                            {(payroll.userDisplayName || "?").substring(0, 2).toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="font-medium text-slate-900">{payroll.userDisplayName || "Unknown"}</div>
                                            <div className="text-xs text-slate-500">{payroll.userEmail}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right font-medium text-slate-600">
                                    ₹{payroll.baseSalary.toLocaleString()}
                                </td>
                                <td className="px-6 py-4 text-right text-emerald-600">
                                    +₹{payroll.incentives.toLocaleString()}
                                </td>
                                <td className="px-6 py-4 text-right text-rose-600">
                                    -₹{payroll.deductions.toLocaleString()}
                                </td>
                                <td className="px-6 py-4 text-right font-bold text-slate-900">
                                    ₹{payroll.netSalary.toLocaleString()}
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                        payroll.status === "PAID" 
                                            ? "bg-emerald-100 text-emerald-800" 
                                            : "bg-amber-100 text-amber-800"
                                    }`}>
                                        {payroll.status === "PAID" ? "Paid" : "Pending"}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {payroll.status !== "PAID" && (
                                            <button 
                                                onClick={() => markAsPaid(payroll.id)}
                                                className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                                title="Mark as Paid"
                                            >
                                                <CheckCircleIcon className="w-5 h-5" />
                                            </button>
                                        )}
                                        <DownloadPayslipButton payroll={payroll} />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>
    </div>
  );
}
