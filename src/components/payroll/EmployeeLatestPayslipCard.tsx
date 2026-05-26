"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useMyUnreadNotifications } from "@/lib/hooks/useNotifications";
import type { EmployeePayslipListResponse } from "@/lib/types/payroll";
import EmployeePayslipDownloadButton from "@/components/payroll/EmployeePayslipDownloadButton";

type Props = {
  uid: string | null;
};

export default function EmployeeLatestPayslipCard({ uid }: Props) {
  const { firebaseUser } = useAuth();
  const { notifications } = useMyUnreadNotifications(uid);
  const [rows, setRows] = useState<EmployeePayslipListResponse["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        throw new Error("error" in payload ? payload.error : "Unable to load latest payslip.");
      }

      setRows((payload as EmployeePayslipListResponse).items);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load latest payslip.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, [firebaseUser, uid]);

  const latest = useMemo(() => rows[0] ?? null, [rows]);
  const payslipNotificationCount = useMemo(
    () =>
      notifications.filter((notification) => {
        const title = notification.title?.toLowerCase() ?? "";
        const body = notification.body?.toLowerCase() ?? "";
        return title.includes("payslip") || body.includes("payslip");
      }).length,
    [notifications],
  );

  return (
    <div className="rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:-translate-y-1 hover:bg-white/80 hover:shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold tracking-tight text-slate-900">Latest Payslip</div>
          <div className="mt-1 text-xs text-slate-500">Newest payslip delivered to your dashboard.</div>
        </div>
        {payslipNotificationCount > 0 ? (
          <div className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">
            {payslipNotificationCount} new
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-6 text-sm text-slate-500">Loading latest payslip...</div>
      ) : error ? (
        <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : !latest ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
          No payslips available
        </div>
      ) : (
        <div className="mt-6">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold tracking-tight text-slate-950">{latest.monthName}</div>
                <div className="mt-1 text-sm text-slate-500">Status {latest.status}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Net Pay</div>
                <div className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
                  INR {Number(latest.netSalary).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <div>Sent {latest.sentAt ? new Date(latest.sentAt).toLocaleDateString() : "-"}</div>
              <div>Downloads {latest.downloadCount}</div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <EmployeePayslipDownloadButton
                payslipId={latest.id}
                filename={`payslip_${latest.employeeId}_${latest.month}.pdf`}
                onSuccess={() => void loadRows()}
                onError={(message) => setError(message)}
              />
              <Link
                href="/employee/payslips"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                View all payslips
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
