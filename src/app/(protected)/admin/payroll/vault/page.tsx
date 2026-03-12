"use client";

import { useState, useEffect } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { AuthGate } from "@/components/auth/AuthGate";
import Image from "next/image";
import { 
  BanknotesIcon, 
  EyeIcon, 
  EyeSlashIcon, 
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  CurrencyRupeeIcon
} from "@heroicons/react/24/outline";

// --- Types ---

interface PayrollUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL?: string | null;
  employeeId?: string;
  role?: string;
  department?: string;
  status?: string;
  // Financials
  baseSalary?: number; // Some users might store it here
  salaryStructure?: {
    base: number;
    hra?: number;
    allowances?: number;
  };
  bankDetails?: {
    accountNumber?: string;
    bankName?: string;
    ifsc?: string;
  };
  payrollStatus?: "active" | "on_hold";
}

// --- Hook Logic (Embedded) ---

function usePayrollFetch() {
  const [employees, setEmployees] = useState<PayrollUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
        setTimeout(() => {
            setError("Firebase not initialized");
            setLoading(false);
        }, 0);
        return;
    }

    // Query: Fetch from users (assuming all users are potential payroll candidates)
    // We can filter by 'active' status if needed, but 'Vault' implies all records.
    const q = query(collection(db, "users"), orderBy("displayName", "asc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        try {
          const data = snapshot.docs.map((doc) => {
            const userData = doc.data();
            // robust mapping with safety checks
            return {
              uid: doc.id,
              displayName: userData.displayName || "Unknown",
              email: userData.email || "",
              photoURL: userData.photoURL,
              employeeId: userData.employeeId,
              role: userData.role,
              department: userData.department,
              status: userData.status,
              // Handle Salary Location (could be root or in structure)
              baseSalary: userData.baseSalary || userData.salaryStructure?.base || 0,
              salaryStructure: userData.salaryStructure,
              // Handle Bank Details Safely
              bankDetails: userData.bankDetails ? {
                accountNumber: userData.bankDetails.accountNumber || "",
                bankName: userData.bankDetails.bankName || "",
                ifsc: userData.bankDetails.ifsc || ""
              } : undefined,
              payrollStatus: userData.payrollStatus || "active"
            } as PayrollUser;
          });

          console.log("Payroll Vault Data:", data); // <--- DEBUGGER
          setEmployees(data);
          setLoading(false);
        } catch (err) {
          console.error("Data Mapping Error:", err);
          setError("Failed to process payroll data. Check console.");
          setLoading(false);
        }
      },
      (err) => {
        console.error("Firestore Fetch Error:", err);
        // User friendly error for permissions
        if (err.code === 'permission-denied') {
             setError("Permission Denied: Check Firestore Rules (users collection)");
        } else {
             setError(err.message);
        }
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  return { employees, loading, error };
}

// --- Components ---

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-slate-100">
      <td className="px-6 py-4"><div className="h-10 w-10 bg-slate-200 rounded-full"></div></td>
      <td className="px-6 py-4"><div className="h-4 w-32 bg-slate-200 rounded"></div></td>
      <td className="px-6 py-4"><div className="h-4 w-24 bg-slate-200 rounded"></div></td>
      <td className="px-6 py-4"><div className="h-6 w-16 bg-slate-200 rounded-full"></div></td>
      <td className="px-6 py-4"><div className="h-8 w-20 bg-slate-200 rounded"></div></td>
    </tr>
  );
}

export default function PayrollVaultPage() {
  const { employees, loading, error } = usePayrollFetch();
  const [showSalaries, setShowSalaries] = useState(false);

  return (
    <AuthGate allowedOrgRoles={["SUPER_ADMIN"]}> {/* High Security Page */}
      <div className="min-h-screen bg-slate-50 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                  <BanknotesIcon className="h-8 w-8 text-indigo-600" />
                  Payroll Vault
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  Secure access to employee compensation and banking details.
                </p>
              </div>
              <div className="flex items-center gap-2">
                 <button 
                   onClick={() => setShowSalaries(!showSalaries)}
                   className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
                 >
                   {showSalaries ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                   {showSalaries ? "Hide Salaries" : "Show Salaries"}
                 </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            
            {/* Error Alert */}
            {error && (
              <div className="mb-6 rounded-md bg-red-50 p-4 border border-red-200 shadow-sm">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <ExclamationTriangleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">Security Alert</h3>
                    <div className="mt-2 text-sm text-red-700">
                      <p>{error}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Table Card */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <div className="flex items-center gap-1">
                          <CurrencyRupeeIcon className="h-4 w-4" />
                          Base Salary
                        </div>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Bank Status</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Payroll Status</th>
                      <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-200">
                    {loading ? (
                       // Skeleton Rows
                       Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                    ) : employees.length === 0 ? (
                       <tr>
                         <td colSpan={5} className="px-6 py-12 text-center text-slate-400 text-sm">
                           No employees found in the directory.
                         </td>
                       </tr>
                    ) : (
                      employees.map((emp) => (
                        <tr key={emp.uid} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="h-10 w-10 flex-shrink-0">
                                {emp.photoURL ? (
                                  <Image 
                                    unoptimized
                                    width={40} 
                                    height={40} 
                                    className="h-10 w-10 rounded-full object-cover ring-2 ring-white" 
                                    src={emp.photoURL} 
                                    alt={emp.displayName || ""} 
                                  />
                                ) : (
                                  <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold ring-2 ring-white">
                                    {(emp.displayName || emp.email || "?")[0]?.toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-medium text-slate-900">{emp.displayName}</div>
                                <div className="text-xs text-slate-500">ID: {emp.employeeId || "—"}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {showSalaries ? (
                               <div className="text-sm font-mono text-slate-900 font-medium">
                                 {emp.baseSalary ? `₹${emp.baseSalary.toLocaleString()}` : <span className="text-slate-400 text-xs italic">Not Set</span>}
                               </div>
                            ) : (
                               <div className="flex items-center gap-1 text-slate-400 text-xs">
                                 <div className="h-2 w-2 bg-slate-300 rounded-full"></div>
                                 <div className="h-2 w-2 bg-slate-300 rounded-full"></div>
                                 <div className="h-2 w-2 bg-slate-300 rounded-full"></div>
                                 <div className="h-2 w-2 bg-slate-300 rounded-full"></div>
                               </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                             {emp.bankDetails ? (
                               <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                                 <CheckCircleIcon className="mr-1 h-3 w-3" />
                                 Linked
                               </span>
                             ) : (
                               <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                                 <ClockIcon className="mr-1 h-3 w-3" />
                                 Pending
                               </span>
                             )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                             <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
                               emp.payrollStatus === 'active' 
                                 ? 'bg-blue-50 text-blue-700 ring-blue-600/20' 
                                 : 'bg-slate-100 text-slate-700 ring-slate-600/20'
                             }`}>
                               {emp.payrollStatus === 'active' ? 'Active' : 'On Hold'}
                             </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button className="text-indigo-600 hover:text-indigo-900 font-semibold text-xs uppercase tracking-wide">
                              Process
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
    </AuthGate>
  );
}
