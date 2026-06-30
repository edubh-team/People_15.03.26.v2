"use client";

import { useState } from "react";
import { ArrowPathIcon, CurrencyRupeeIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthProvider";
import { cn } from "@/lib/cn";
import type { PayrollDetailsResponse } from "@/lib/types/payroll";

type Props = {
  employeeId: string;
  month: string;
  disabled?: boolean;
  onSuccess: (payload: PayrollDetailsResponse) => void;
  onError: (message: string) => void;
};

export default function GeneratePayrollButton({
  employeeId,
  month,
  disabled = false,
  onSuccess,
  onError,
}: Props) {
  const { firebaseUser } = useAuth();
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    if (!firebaseUser || disabled || loading) return;

    try {
      setLoading(true);
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/payroll/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          employeeId,
          month,
        }),
      });

      const payload = (await response.json()) as PayrollDetailsResponse | { error?: string };

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Payroll generation failed.");
      }

      onSuccess(payload as PayrollDetailsResponse);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : "Payroll generation failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleGenerate}
      disabled={disabled || loading}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition",
        disabled
          ? "cursor-not-allowed bg-slate-100 text-slate-400"
          : "bg-slate-900 text-white hover:bg-slate-800",
      )}
    >
      {loading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CurrencyRupeeIcon className="h-4 w-4" />}
      {loading ? "Generating..." : "Generate"}
    </button>
  );
}
