"use client";

import React, { useState } from "react";
import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthProvider";
import { buildPayslipPreviewModel } from "@/lib/payroll/payslip";
import type { Payroll } from "@/lib/types/hr";

interface DownloadPayslipButtonProps {
  payroll: Payroll;
  employee?: {
    name: string;
    employeeId: string;
    designation?: string | null;
    department?: string | null;
  };
  onError?: (message: string) => void;
  variant?: "icon" | "button";
  className?: string;
  label?: string;
}

const DownloadPayslipButton: React.FC<DownloadPayslipButtonProps> = ({
  payroll,
  employee,
  onError,
  variant = "icon",
  className = "",
  label = "Download Payslip",
}) => {
  const { firebaseUser } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    try {
      if (!firebaseUser) {
        throw new Error("You must be signed in to download a payslip.");
      }

      setLoading(true);
      const token = await firebaseUser.getIdToken();
      const employeeKey = payroll.employeeId || payroll.uid;
      if (!employeeKey) {
        throw new Error("Payroll record is missing an employee identifier.");
      }

      const searchParams = new URLSearchParams();
      if (payroll.id) {
        searchParams.set("payrollId", payroll.id);
      }

      const requestUrl = `/api/payroll/${encodeURIComponent(employeeKey)}/${encodeURIComponent(payroll.month)}/pdf${
        searchParams.size > 0 ? `?${searchParams.toString()}` : ""
      }`;

      const response = await fetch(requestUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ error: "Failed to download PDF." }))) as {
          error?: string;
        };
        throw new Error(payload.error || "Failed to download PDF.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const fallbackEmployee = employee ?? {
        name: payroll.userDisplayName || payroll.userEmail || payroll.uid,
        employeeId: payroll.employeeId || payroll.uid,
        designation: payroll.designation,
        department: payroll.department,
      };
      const payslip = buildPayslipPreviewModel({
        employee: fallbackEmployee,
        payroll,
      });
      link.href = url;
      link.download = payslip.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate PDF";
      console.warn("Payslip download failed:", message);
      onError?.(message);
      if (!onError) {
        window.alert(message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={handleDownload}
        disabled={loading}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 ${className}`.trim()}
      >
        {loading ? (
          <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
        ) : (
          <ArrowDownTrayIcon className="h-4 w-4" />
        )}
        <span>{loading ? "Downloading..." : label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={loading}
      className={`rounded-lg p-1.5 text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-50 ${className}`.trim()}
      title="Download Payslip"
    >
      {loading ? (
        <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      ) : (
        <ArrowDownTrayIcon className="w-5 h-5" />
      )}
    </button>
  );
};

export default DownloadPayslipButton;
