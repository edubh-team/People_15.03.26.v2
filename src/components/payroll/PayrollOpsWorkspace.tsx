"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowPathIcon, CurrencyRupeeIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthProvider";
import EditPayrollModal from "@/components/hr/EditPayrollModal";
import PayrollDashboardCards from "@/components/payroll/PayrollDashboardCards";
import PayslipPreviewModal from "@/components/payroll/PayslipPreviewModal";
import PayrollTable from "@/components/payroll/PayrollTable";
import PayrollToast from "@/components/payroll/PayrollToast";
import type { BulkGeneratePayrollResponse, PayrollListItem, PayrollListResponse } from "@/lib/types/payroll";

type ToastState = {
  tone: "success" | "error" | "info";
  message: string;
} | null;

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const emptyState: PayrollListResponse = {
  month: getCurrentMonthKey(),
  summary: {
    totalEmployees: 0,
    totalPayout: 0,
    payrollRecords: 0,
  },
  items: [],
};

export default function PayrollOpsWorkspace() {
  const { firebaseUser } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthKey);
  const [data, setData] = useState<PayrollListResponse>(emptyState);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [previewItem, setPreviewItem] = useState<PayrollListItem | null>(null);
  const [editingItem, setEditingItem] = useState<PayrollListItem | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function loadPayroll(month = selectedMonth, useLoadingState = true) {
    if (!firebaseUser) return;

    try {
      if (useLoadingState) {
        setLoading(true);
      } else {
        setReloading(true);
      }

      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/payroll?month=${encodeURIComponent(month)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const payload = (await response.json()) as PayrollListResponse | { error?: string };

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Unable to load payroll.");
      }

      setData(payload as PayrollListResponse);
    } catch (error: unknown) {
      setToast({
        tone: "error",
        message: error instanceof Error ? error.message : "Unable to load payroll.",
      });
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }

  useEffect(() => {
    void loadPayroll(selectedMonth, true);
  }, [firebaseUser, selectedMonth]);

  const payrollRecordsLabel = useMemo(
    () => `${data.summary.payrollRecords} / ${data.summary.totalEmployees}`,
    [data.summary.payrollRecords, data.summary.totalEmployees],
  );
  const pendingGeneratableCount = useMemo(
    () => data.items.filter((item) => !item.payroll && item.status === "NOT_GENERATED").length,
    [data.items],
  );

  function buildBulkToastMessage(payload: BulkGeneratePayrollResponse) {
    const parts = [
      `Generated ${payload.summary.generated}`,
      `already done ${payload.summary.alreadyGenerated}`,
      `missing attendance ${payload.summary.missingAttendance}`,
      `zero salary ${payload.summary.zeroSalary}`,
    ];

    if (payload.summary.failed > 0) {
      parts.push(`failed ${payload.summary.failed}`);
    }

    return `Batch payroll finished for ${payload.month}: ${parts.join(", ")}.`;
  }

  async function handleBulkGenerate() {
    if (!firebaseUser || bulkGenerating) return;

    if (pendingGeneratableCount === 0) {
      setToast({
        tone: "info",
        message: `No pending employees left to generate for ${selectedMonth}.`,
      });
      return;
    }

    try {
      setBulkGenerating(true);
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/payroll/generate/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ month: selectedMonth }),
      });

      const payload = (await response.json()) as BulkGeneratePayrollResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Unable to generate payroll batch.");
      }

      setToast({
        tone: "success",
        message: buildBulkToastMessage(payload as BulkGeneratePayrollResponse),
      });
      await loadPayroll(selectedMonth, false);
    } catch (error: unknown) {
      setToast({
        tone: "error",
        message: error instanceof Error ? error.message : "Unable to generate payroll batch.",
      });
    } finally {
      setBulkGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-100 bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">
              Payroll Ops
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
              Dynamic Payroll Workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Generate payroll from employee salary and attendance, track live records, and download system-generated payslips.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="text-sm font-medium text-slate-600">
              <span className="sr-only">Payroll month</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none ring-indigo-500/20 transition focus:ring-4"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleBulkGenerate()}
              disabled={loading || bulkGenerating}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {bulkGenerating ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
              ) : (
                <CurrencyRupeeIcon className="h-4 w-4" />
              )}
              {bulkGenerating ? "Generating all..." : "Generate All Pending"}
            </button>
            <button
              type="button"
              onClick={() => void loadPayroll(selectedMonth, false)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <ArrowPathIcon className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">Month {selectedMonth}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">Records {payrollRecordsLabel}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">Pending {pendingGeneratableCount}</span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">Live</span>
        </div>
      </section>

      {toast ? <PayrollToast tone={toast.tone} message={toast.message} /> : null}

      <PayrollDashboardCards summary={data.summary} loading={loading} />

      <PayrollTable
        month={selectedMonth}
        items={data.items}
        loading={loading}
        reloading={reloading}
        onGenerated={() => {
          void loadPayroll(selectedMonth, false);
        }}
        onToast={(message, tone = "info" as const) => setToast({ message, tone })}
        onEdit={(item) => setEditingItem(item)}
        onPreview={(item) => setPreviewItem(item)}
      />

      <PayslipPreviewModal
        isOpen={Boolean(previewItem)}
        payroll={previewItem?.payroll ?? null}
        employee={previewItem?.employee ?? null}
        onClose={() => setPreviewItem(null)}
        onError={(message) => setToast({ message, tone: "error" })}
      />

      <EditPayrollModal
        isOpen={Boolean(editingItem)}
        payroll={editingItem?.payroll ?? null}
        onClose={() => setEditingItem(null)}
        onSuccess={() => {
          setEditingItem(null);
          setToast({ message: "Payroll components updated successfully.", tone: "success" });
          void loadPayroll(selectedMonth, false);
        }}
      />
    </div>
  );
}
