"use client";

import { AuthGate } from "@/components/auth/AuthGate";
import FinanceDashboard from "@/components/finance/FinanceDashboard";
import { canAccessFinance } from "@/lib/access";

export default function FinancePage() {
  return (
    <AuthGate allowIf={(user) => canAccessFinance(user)}>
      <FinanceDashboard />
    </AuthGate>
  );
}
