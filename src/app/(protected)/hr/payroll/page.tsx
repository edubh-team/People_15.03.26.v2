"use client";

import { useState, useEffect, useMemo } from "react";
import { db } from "@/lib/firebase/client";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Payroll } from "@/lib/types/hr";
import { UserDoc } from "@/lib/types/user";
import { Dialog } from "@headlessui/react";
import { CurrencyRupeeIcon, ArrowPathIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthProvider";
import { generatePayroll } from "@/app/actions/hr";
import dynamic from "next/dynamic";
import EditPayrollModal from "@/components/hr/EditPayrollModal";
import { RoleBadge } from "@/components/RoleBadge";

const DownloadPayslipButton = dynamic(
  () => import("@/components/hr/DownloadPayslipButton"),
  { 
    ssr: false, 
    loading: () => <div className="w-8 h-8 rounded-lg bg-slate-100 animate-pulse" /> 
  }
);

export default function PayrollPage() {
  const { firebaseUser } = useAuth();
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  });
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingPayroll, setEditingPayroll] = useState<Payroll | null>(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db) return;
    
    // Fetch Users (Active & Non-SuperAdmin)
    const qUsers = query(collection(db, "users"), where("status", "==", "active"));
    const unsubUsers = onSnapshot(qUsers, (snap) => {
        const data = snap.docs.map(d => d.data() as UserDoc);
        const filtered = data.filter(u => {
            const r = (u.role || "").toLowerCase();
            const or = (u.orgRole || "").toLowerCase();
            return r !== "super_admin" && or !== "super_admin";
        }).sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
        setUsers(filtered);
        setLoading(false);
    });

    return () => unsubUsers();
  }, []);

  useEffect(() => {
    if (!db) return;
    // Query payrolls for selected month
    const q = query(
        collection(db, "payroll"), 
        where("month", "==", selectedMonth)
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Payroll));
      setPayrolls(data);
    });
    return () => unsub();
  }, [selectedMonth]);

  const handleGenerate = async () => {
    if (!firebaseUser) return;
    setIsGenerating(true);
    
    const token = await firebaseUser.getIdToken();
    const result = await generatePayroll(selectedMonth, token);
    
    setIsGenerating(false);
    if (result.success) {
        setIsGenerateOpen(false);
        alert(`Payroll generated for ${result.count} employees.`);
    } else {
        alert("Error: " + result.error);
    }
  };

  const handleEditClick = (user: UserDoc, existingPayroll?: Payroll) => {
    if (existingPayroll) {
        setEditingPayroll(existingPayroll);
    } else {
        // Create a temporary payroll object for the modal
        // This won't exist in DB yet, but allows editing
        setEditingPayroll({
            id: `${user.uid}_${selectedMonth}`,
            uid: user.uid,
            month: selectedMonth,
            baseSalary: user.salaryStructure?.base || 0,
            bonus: 0, // Default
            deductions: 0,
            commissionPercentage: 0,
            daysPresent: 0, // Placeholder
            daysAbsent: 0,
            lates: 0,
            incentives: 0,
            netSalary: 0,
            status: "PENDING_CREATION", // Internal flag
            generatedAt: new Date(),
            userDisplayName: user.displayName || undefined,
            userEmail: user.email || undefined
        });
    }
  };

  const combinedData = useMemo(() => {
    return users.map(user => {
        const payroll = payrolls.find(p => p.uid === user.uid);
        return { user, payroll };
    });
  }, [users, payrolls]);

  const totalPayout = payrolls.reduce((sum, p) => sum + p.netSalary, 0);
  const leaveImpact = useMemo(() => {
    const leaveDeductionTotal = payrolls.reduce((sum, payroll) => sum + Number(payroll.leaveDeduction || 0), 0);
    const leaveExcessDaysTotal = payrolls.reduce((sum, payroll) => sum + Number(payroll.leaveExcessDays || 0), 0);
    const employeesAboveAllowance = payrolls.filter((payroll) => Number(payroll.leaveExcessDays || 0) > 0).length;
    return { leaveDeductionTotal, leaveExcessDaysTotal, employeesAboveAllowance };
  }, [payrolls]);

  const stats = useMemo(() => {
    const normalize = (r: string) => r.toLowerCase().replace(/[^a-z0-9]/g, "");
    return {
      employees: users.filter(e => normalize(e.role || "").includes("employee")).length,
      managers: users.filter(e => normalize(e.role || "").includes("manager")).length,
      teamLeads: users.filter(e => normalize(e.role || "").includes("team")).length,
    };
  }, [users]);

  if (loading) {
    return (
        <div className="flex items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Payroll Management</h1>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
             <input 
               type="month" 
               className="border rounded-lg px-3 py-2 text-sm w-full sm:w-auto focus:ring-2 focus:ring-indigo-500 outline-none"
               value={selectedMonth}
               onChange={e => setSelectedMonth(e.target.value)}
             />
             <button 
               onClick={() => setIsGenerateOpen(true)}
               className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-sm transition-colors w-full sm:w-auto"
             >
                <CurrencyRupeeIcon className="w-5 h-5" />
                Run Payroll
             </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div className="text-sm font-medium text-slate-500">Total Payout</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">₹{totalPayout.toLocaleString()}</div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div className="text-sm font-medium text-slate-500">Payroll Status</div>
             <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{payrolls.length}</span>
                <span className="text-sm text-slate-500">/ {users.length} Paid</span>
            </div>
            <div className="mt-1 text-xs font-medium text-emerald-600">
                {payrolls.length > 0 ? "In Progress" : "Pending Generation"}
            </div>
        </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div className="text-sm font-medium text-slate-500">Workforce Breakdown</div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div>
                    <div className="text-lg font-bold text-slate-900">{stats.managers}</div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Managers</div>
                </div>
                <div className="border-l border-slate-100">
                    <div className="text-lg font-bold text-slate-900">{stats.teamLeads}</div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Leads</div>
                </div>
                <div className="border-l border-slate-100">
                    <div className="text-lg font-bold text-slate-900">{stats.employees}</div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Staff</div>
                </div>
            </div>
        </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div className="text-sm font-medium text-slate-500">Leave Deduction (Month)</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">â‚¹{leaveImpact.leaveDeductionTotal.toLocaleString()}</div>
            <div className="mt-1 text-xs font-medium text-amber-600">
                {leaveImpact.employeesAboveAllowance} employees above 14 days | {leaveImpact.leaveExcessDaysTotal} excess days
            </div>
        </div>
      </div>

      {/* Mobile View: Cards */}
      <div className="block md:hidden space-y-4">
        {combinedData.length === 0 ? (
            <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-slate-500 italic">
                No active employees found.
            </div>
        ) : (
            combinedData.map(({ user, payroll }) => (
                <div key={user.uid} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="font-medium text-slate-900">{user.displayName || "Unknown"}</div>
                            <div className="text-xs text-slate-500 break-all">{user.email}</div>
                            <div className="mt-1">
                                <RoleBadge role={user.role || "Employee"} />
                            </div>
                        </div>
                        {payroll ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                {payroll.status}
                            </span>
                        ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                                Pending
                            </span>
                        )}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <div className="text-slate-500 text-xs">Base Salary</div>
                            <div className="font-medium mt-1">
                                {payroll 
                                    ? `INR ${payroll.baseSalary?.toLocaleString()}` 
                                    : (user.salaryStructure?.base ? `INR ${Number(user.salaryStructure.base).toLocaleString()} (Est)` : "-")
                                }
                            </div>
                        </div>
                        <div>
                            <div className="text-slate-500 text-xs">Net Salary</div>
                            <div className="font-bold mt-1 text-slate-900">
                                {payroll ? `INR ${payroll.netSalary?.toLocaleString()}` : "-"}
                            </div>
                        </div>
                        <div>
                            <div className="text-slate-500 text-xs">Days Present</div>
                            <div className="mt-1">{payroll ? payroll.daysPresent : "-"}</div>
                        </div>
                        <div>
                            <div className="text-slate-500 text-xs">Deductions</div>
                            <div className="mt-1 text-red-600">
                                {payroll ? `-INR ${payroll.deductions?.toLocaleString()}` : "-"}
                            </div>
                            {payroll ? (
                                <div className="mt-1 text-[11px] text-slate-500">
                                    Leave: INR {Number(payroll.leaveDeduction || 0).toLocaleString()} | Excess: {Number(payroll.leaveExcessDays || 0)}
                                </div>
                            ) : null}
                        </div>
                        <div>
                            <div className="text-slate-500 text-xs">Leave Approved</div>
                            <div className="mt-1">{payroll ? Number(payroll.leaveApprovedDays || 0) : "-"}</div>
                        </div>
                        <div className="col-span-2">
                            <div className="text-slate-500 text-xs">Attendance Corrections</div>
                            <div className="mt-1">
                                {payroll
                                    ? `${Number(payroll.attendanceCorrectionCount || 0)} total | ${Number(payroll.attendanceCorrectionPendingCount || 0)} pending`
                                    : "-"}
                            </div>
                            {payroll?.attendanceCorrectionSummary ? (
                                <div className="mt-1 text-[11px] text-slate-500">
                                    {payroll.attendanceCorrectionSummary}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {payroll && (
                        <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                             <button 
                                onClick={() => handleEditClick(user, payroll)}
                                className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg"
                                title="Edit Payroll"
                            >
                                <PencilSquareIcon className="w-5 h-5" />
                            </button>
                            <DownloadPayslipButton payroll={payroll} />
                        </div>
                    )}
                    {!payroll && (
                        <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                             <button 
                                onClick={() => handleEditClick(user)}
                                className="p-2 text-slate-400 hover:bg-slate-50 hover:text-indigo-600 rounded-lg"
                                title="Create & Edit Payroll"
                            >
                                <PencilSquareIcon className="w-5 h-5" />
                            </button>
                        </div>
                    )}
                </div>
            ))
        )}
      </div>

      {/* Desktop View: Table */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                    <th className="px-6 py-4 font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 font-medium text-slate-500 text-right">Base Salary</th>
                    <th className="px-6 py-4 font-medium text-slate-500 text-center">Days Present</th>
                    <th className="px-6 py-4 font-medium text-slate-500 text-center">Leave (Approved/Excess)</th>
                    <th className="px-6 py-4 font-medium text-slate-500 text-center">Attendance Corrections</th>
                    <th className="px-6 py-4 font-medium text-slate-500 text-right">Deductions</th>
                    <th className="px-6 py-4 font-medium text-slate-500 text-right">Net Salary</th>
                    <th className="px-6 py-4 font-medium text-slate-500">Status</th>
                    <th className="px-6 py-4 font-medium text-slate-500 text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {combinedData.length === 0 ? (
                    <tr>
                        <td colSpan={9} className="px-6 py-8 text-center text-slate-500 italic">
                            No active employees found.
                        </td>
                    </tr>
                ) : (
                    combinedData.map(({ user, payroll }) => (
                        <tr key={user.uid} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 font-medium text-slate-900">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold">
                                        {(user.displayName || "?")[0].toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="font-bold text-slate-900">{user.displayName || "Unknown"}</div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-xs text-slate-500">{user.email}</span>
                                            <RoleBadge role={user.role || "Employee"} />
                                        </div>
                                    </div>
                                </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                                {payroll 
                                    ? `INR ${payroll.baseSalary?.toLocaleString()}` 
                                    : (user.salaryStructure?.base ? `INR ${Number(user.salaryStructure.base).toLocaleString()} (Est)` : "-")
                                }
                            </td>
                            <td className="px-6 py-4 text-center">{payroll ? payroll.daysPresent : "-"}</td>
                            <td className="px-6 py-4 text-center">
                                {payroll ? `${Number(payroll.leaveApprovedDays || 0)} / ${Number(payroll.leaveExcessDays || 0)}` : "-"}
                            </td>
                            <td className="px-6 py-4 text-center text-xs text-slate-600">
                                {payroll ? (
                                  <div>
                                    <div>
                                      {Number(payroll.attendanceCorrectionCount || 0)} total / {Number(payroll.attendanceCorrectionPendingCount || 0)} pending
                                    </div>
                                    {payroll.attendanceCorrectionSummary ? (
                                      <div className="mt-1 text-[10px] text-slate-500">
                                        {payroll.attendanceCorrectionSummary}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : "-"}
                            </td>
                            <td className="px-6 py-4 text-right text-red-600">
                                {payroll ? `-INR ${payroll.deductions?.toLocaleString()}` : "-"}
                                {payroll ? (
                                  <div className="text-[10px] text-slate-500">
                                    Leave: INR {Number(payroll.leaveDeduction || 0).toLocaleString()}
                                  </div>
                                ) : null}
                            </td>
                            <td className="px-6 py-4 text-right font-bold text-slate-900">
                                {payroll ? `INR ${payroll.netSalary?.toLocaleString()}` : "-"}
                            </td>
                            <td className="px-6 py-4">
                                {payroll ? (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                        {payroll.status}
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                                        Pending
                                    </span>
                                )}
                            </td>
                            <td className="px-6 py-4 text-right">
                                <div className="flex justify-end gap-2">
                                    <button 
                                        onClick={() => handleEditClick(user, payroll)}
                                        className={`p-1.5 rounded-lg ${payroll ? 'text-indigo-600 hover:bg-indigo-50' : 'text-slate-400 hover:bg-slate-50 hover:text-indigo-600'}`}
                                        title={payroll ? "Edit Payroll" : "Create & Edit Payroll"}
                                    >
                                        <PencilSquareIcon className="w-5 h-5" />
                                    </button>
                                    {payroll && <DownloadPayslipButton payroll={payroll} />}
                                </div>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
        </table>
      </div>

      <Dialog open={isGenerateOpen} onClose={() => setIsGenerateOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-sm rounded-xl bg-white p-6 shadow-xl w-full">
            <Dialog.Title className="text-lg font-bold text-slate-900 mb-2">Generate Payroll</Dialog.Title>
            <Dialog.Description className="text-slate-500 mb-6">
                Are you sure you want to generate payroll for <strong>{selectedMonth}</strong>? 
                This will calculate salaries based on attendance records.
            </Dialog.Description>
            
            <div className="flex justify-end gap-3">
                <button
                  onClick={() => setIsGenerateOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm flex items-center gap-2"
                >
                  {isGenerating && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
                  {isGenerating ? "Processing..." : "Confirm & Generate"}
                </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
      <EditPayrollModal 
        isOpen={!!editingPayroll} 
        onClose={() => setEditingPayroll(null)} 
        payroll={editingPayroll}
        onSuccess={() => {
            // Real-time listener handles refresh
        }}
      />
    </div>
  );
}


