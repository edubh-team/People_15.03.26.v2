"use client";

import { useEffect, useState } from "react";
import { EyeIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthProvider";
import EmployeePayslipDetailsModal from "@/components/payroll/EmployeePayslipDetailsModal";
import EmployeePayslipDownloadButton from "@/components/payroll/EmployeePayslipDownloadButton";
import type {
  EmployeePayslipDetailsResponse,
  EmployeePayslipListResponse,
} from "@/lib/types/payroll";

type Props = {
  uid: string | null;
  title?: string;
  compact?: boolean;
};

export default function EmployeePayslipsPanel({
  uid,
  title = "My Payslips",
  compact = false,
}: Props) {
  const { firebaseUser } = useAuth();
  const [rows, setRows] = useState<EmployeePayslipListResponse["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [details, setDetails] = useState<EmployeePayslipDetailsResponse | null>(null);

  async function loadRows() {
    if (!uid || !firebaseUser) {
      setRows([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/employee/payslips", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const payload = (await response.json()) as EmployeePayslipListResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Unable to load payslips.");
      }

      setRows((payload as EmployeePayslipListResponse).items);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load payslips.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, [firebaseUser, uid]);

  async function handleView(payslipId: string) {
    if (!firebaseUser) return;

    try {
      setDetailLoadingId(payslipId);
      setError(null);
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/employee/payslips/${encodeURIComponent(payslipId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const payload = (await response.json()) as EmployeePayslipDetailsResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Unable to load payslip details.");
      }

      setDetails(payload as EmployeePayslipDetailsResponse);
      await loadRows();
    } catch (detailError: unknown) {
      setError(detailError instanceof Error ? detailError.message : "Unable to load payslip details.");
    } finally {
      setDetailLoadingId(null);
    }
  }

  const containerClasses = compact
    ? "rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
    : "rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm";

  return (
    <div className={containerClasses}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold tracking-tight text-slate-950">{title}</div>
          <div className="mt-1 text-sm text-slate-500">
            Month-wise payslips sent by HR. Views and downloads are audited automatically.
          </div>
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
          {rows.length} record{rows.length === 1 ? "" : "s"}
        </div>
      </div>

      {loading ? (
        <div className="mt-6 text-sm text-slate-500">Loading payslips...</div>
      ) : error ? (
        <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          No payslips available
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-5 py-4">Month</th>
                  <th className="px-5 py-4 text-right">Gross Salary</th>
                  <th className="px-5 py-4 text-right">Net Salary</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Sent Date</th>
                  <th className="px-5 py-4">Downloads</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">{row.monthName}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.month}</div>
                    </td>
                    <td className="px-5 py-4 text-right font-medium text-slate-900">
                      INR {Number(row.grossSalary).toLocaleString()}
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-slate-900">
                      INR {Number(row.netSalary).toLocaleString()}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">
                        {row.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {row.sentAt ? new Date(row.sentAt).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      <div>{row.downloadCount}</div>
                      {row.downloadHistory[0]?.downloadedAt ? (
                        <div className="mt-1 text-xs text-slate-400">
                          Last: {new Date(row.downloadHistory[row.downloadHistory.length - 1].downloadedAt ?? "").toLocaleDateString()}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void handleView(row.id)}
                          disabled={detailLoadingId === row.id}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <EyeIcon className="h-4 w-4" />
                          <span>{detailLoadingId === row.id ? "Loading..." : "View"}</span>
                        </button>
                        <EmployeePayslipDownloadButton
                          payslipId={row.id}
                          filename={`payslip_${row.employeeId}_${row.month}.pdf`}
                          variant="ghost"
                          onSuccess={() => void loadRows()}
                          onError={(message) => setError(message)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <EmployeePayslipDetailsModal
        details={details}
        isOpen={Boolean(details)}
        onClose={() => setDetails(null)}
        onDownloadSuccess={() => void loadRows()}
        onError={(message) => setError(message)}
      />
    </div>
  );
}
