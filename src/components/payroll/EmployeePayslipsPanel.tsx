"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import DownloadPayslipButton from "@/components/hr/DownloadPayslipButton";
import PayslipPreviewModal from "@/components/payroll/PayslipPreviewModal";
import { db } from "@/lib/firebase/client";
import type { Payroll } from "@/lib/types/hr";

type Props = {
  uid: string | null;
  title?: string;
};

export default function EmployeePayslipsPanel({ uid, title = "My Payslips" }: Props) {
  const [rows, setRows] = useState<Payroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewRow, setPreviewRow] = useState<Payroll | null>(null);

  useEffect(() => {
    let active = true;

    async function loadRows() {
      if (!db || !uid) {
        if (active) {
          setRows([]);
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const snapshot = await getDocs(query(collection(db, "payroll"), where("uid", "==", uid)));
        if (!active) return;

        const items = snapshot.docs
          .map((row) => ({ ...(row.data() as Payroll), id: row.id }))
          .sort((left, right) => right.month.localeCompare(left.month));
        setRows(items);
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
  }, [uid]);

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <div className="mt-1 text-xs text-slate-500">
        Download system-generated salary slips from your account.
      </div>

      {loading ? (
        <div className="mt-4 text-sm text-slate-500">Loading payslips...</div>
      ) : error ? (
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Payslips will appear here after payroll is generated for your account.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">{row.month}</div>
                <div className="mt-1 text-xs text-slate-500">
                  Net Pay: INR {Number(row.netPay ?? row.netSalary ?? 0).toLocaleString()} | {row.status}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewRow(row)}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Preview
                </button>
                <DownloadPayslipButton
                  payroll={row}
                  employee={{
                    name: row.userDisplayName || row.userEmail || row.uid,
                    employeeId: row.employeeId || row.uid,
                    designation: row.designation,
                    department: row.department,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <PayslipPreviewModal
        isOpen={Boolean(previewRow)}
        payroll={previewRow}
        employee={
          previewRow
            ? {
                name: previewRow.userDisplayName || previewRow.userEmail || previewRow.uid,
                employeeId: previewRow.employeeId || previewRow.uid,
                designation: previewRow.designation,
                department: previewRow.department,
              }
            : null
        }
        onClose={() => setPreviewRow(null)}
      />
    </div>
  );
}
