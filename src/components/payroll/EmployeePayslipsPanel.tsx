"use client";

import { useEffect, useState } from "react";
import DownloadPayslipButton from "@/components/hr/DownloadPayslipButton";
import PayslipPreviewModal from "@/components/payroll/PayslipPreviewModal";
import { useAuth } from "@/components/auth/AuthProvider";
import type { Payroll } from "@/lib/types/hr";
import type {
  EmployeePayslipListResponse,
  PayrollDetailsResponse,
} from "@/lib/types/payroll";

type Props = {
  uid: string | null;
  title?: string;
};

export default function EmployeePayslipsPanel({ uid, title = "My Payslips" }: Props) {
  const { firebaseUser } = useAuth();
  const [rows, setRows] = useState<EmployeePayslipListResponse["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewDetails, setPreviewDetails] = useState<PayrollDetailsResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadRows() {
      if (!uid || !firebaseUser) {
        if (active) {
          setRows([]);
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const token = await firebaseUser.getIdToken();
        const response = await fetch("/api/payroll/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });

        const payload = (await response.json()) as EmployeePayslipListResponse | { error?: string };
        if (!response.ok) {
          throw new Error("error" in payload ? payload.error : "Unable to load payslips.");
        }

        if (!active) return;
        setRows((payload as EmployeePayslipListResponse).items);
      } catch (loadError: unknown) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load payslips.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadRows();
    return () => {
      active = false;
    };
  }, [firebaseUser, uid]);

  async function handlePreview(month: string, employeeId: string) {
    if (!firebaseUser) return;

    try {
      setPreviewLoading(true);
      const token = await firebaseUser.getIdToken();
      const response = await fetch(
        `/api/payroll/${encodeURIComponent(employeeId)}/${encodeURIComponent(month)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        },
      );

      const payload = (await response.json()) as PayrollDetailsResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Unable to preview payslip.");
      }

      setPreviewDetails(payload as PayrollDetailsResponse);
    } catch (previewError: unknown) {
      setError(previewError instanceof Error ? previewError.message : "Unable to preview payslip.");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <div className="mt-1 text-xs text-slate-500">
        View only payslips that HR has sent to your dashboard. Download audit is tracked automatically.
      </div>

      {loading ? (
        <div className="mt-4 text-sm text-slate-500">Loading payslips...</div>
      ) : error ? (
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Payslips will appear here after HR sends them to your account.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">{row.month}</div>
                <div className="mt-1 text-xs text-slate-500">
                  Net Pay: INR {Number(row.netPay).toLocaleString()} | Status: {row.status}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Downloads: {row.downloadCount} {row.downloadedAt ? `| Last download: ${new Date(row.downloadedAt).toLocaleDateString()}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={previewLoading}
                  onClick={() => void handlePreview(row.month, row.employee.employeeId)}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {previewLoading ? "Loading..." : "Preview"}
                </button>
                <DownloadPayslipButton
                  payroll={
                    (previewDetails?.payroll &&
                    previewDetails.employee.employeeId === row.employee.employeeId &&
                    previewDetails.payroll.month === row.month
                      ? previewDetails.payroll
                      : {
                          id: row.id,
                          uid: row.employee.uid,
                          employeeId: row.employee.employeeId,
                          month: row.month,
                          baseSalary: row.netPay,
                          daysPresent: 0,
                          daysAbsent: 0,
                          lates: 0,
                          incentives: 0,
                          deductions: 0,
                          netSalary: row.netPay,
                          status: row.status,
                          generatedAt: new Date(),
                          netPay: row.netPay,
                        }) as Payroll
                  }
                  employee={row.employee}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <PayslipPreviewModal
        isOpen={Boolean(previewDetails)}
        payroll={previewDetails?.payroll ?? null}
        employee={previewDetails?.employee ?? null}
        onClose={() => setPreviewDetails(null)}
        onError={(message) => setError(message)}
      />
    </div>
  );
}
