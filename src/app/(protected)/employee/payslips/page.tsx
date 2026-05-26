"use client";

import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import EmployeePayslipsPanel from "@/components/payroll/EmployeePayslipsPanel";

export default function EmployeePayslipsPage() {
  const { firebaseUser } = useAuth();

  return (
    <AuthGate>
      <div className="space-y-6">
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Employee Payroll
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            My Payslips
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Review month-wise salary slips, open full details, and download official PDF copies sent by HR.
          </p>
        </section>

        <EmployeePayslipsPanel uid={firebaseUser?.uid ?? null} />
      </div>
    </AuthGate>
  );
}
