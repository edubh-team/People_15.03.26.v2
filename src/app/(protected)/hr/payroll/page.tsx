"use client";

import { AuthGate } from "@/components/auth/AuthGate";
import PayrollOpsWorkspace from "@/components/payroll/PayrollOpsWorkspace";
import { isAdminUser, isHrUser } from "@/lib/access";

export default function HrPayrollPage() {
  return (
    <AuthGate allowIf={(user) => isHrUser(user) || isAdminUser(user)}>
      <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <PayrollOpsWorkspace />
        </div>
      </div>
    </AuthGate>
  );
}
