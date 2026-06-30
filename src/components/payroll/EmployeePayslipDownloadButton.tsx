"use client";

import { useState } from "react";
import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthProvider";

type Props = {
  payslipId: string;
  filename: string;
  onSuccess?: () => void;
  onError?: (message: string) => void;
  variant?: "button" | "ghost";
  label?: string;
  className?: string;
};

export default function EmployeePayslipDownloadButton({
  payslipId,
  filename,
  onSuccess,
  onError,
  variant = "button",
  label = "Download PDF",
  className = "",
}: Props) {
  const { firebaseUser } = useAuth();
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    try {
      if (!firebaseUser) {
        throw new Error("You must be signed in to download this payslip.");
      }

      setLoading(true);
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/employee/payslips/${encodeURIComponent(payslipId)}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ error: "Failed to download payslip." }))) as {
          error?: string;
        };
        throw new Error(payload.error || "Failed to download payslip.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      onSuccess?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to download payslip.";
      onError?.(message);
      if (!onError) {
        window.alert(message);
      }
    } finally {
      setLoading(false);
    }
  }

  if (variant === "ghost") {
    return (
      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={loading}
        className={`inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
      >
        <ArrowDownTrayIcon className="h-4 w-4" />
        <span>{loading ? "Downloading..." : label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void handleDownload()}
      disabled={loading}
      className={`inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 ${className}`.trim()}
    >
      <ArrowDownTrayIcon className="h-4 w-4" />
      <span>{loading ? "Downloading..." : label}</span>
    </button>
  );
}
