"use client";

import { ArrowPathIcon } from "@heroicons/react/24/outline";
import DownloadPayslipButton from "@/components/hr/DownloadPayslipButton";
import GeneratePayrollButton from "@/components/payroll/GeneratePayrollButton";
import type { PayrollListItem } from "@/lib/types/payroll";

type Props = {
  month: string;
  items: PayrollListItem[];
  loading: boolean;
  reloading: boolean;
  onGenerated: () => void;
  onToast: (message: string, tone?: "success" | "error" | "info") => void;
  onEdit: (item: PayrollListItem) => void;
  onPreview: (item: PayrollListItem) => void;
};

function getStatusClasses(status: PayrollListItem["status"]) {
  switch (status) {
    case "GENERATED":
      return "bg-emerald-50 text-emerald-700";
    case "PAID":
      return "bg-indigo-50 text-indigo-700";
    case "ZERO_SALARY":
      return "bg-rose-50 text-rose-700";
    case "MISSING_ATTENDANCE":
      return "bg-amber-50 text-amber-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function PayrollTable({
  month,
  items,
  loading,
  reloading,
  onGenerated,
  onToast,
  onEdit,
  onPreview,
}: Props) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">
        Loading payroll records...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm">
        <div className="text-base font-semibold text-slate-900">No payroll employees found</div>
        <div className="mt-2 text-sm text-slate-500">
          Add active employees with salary data to start generating payroll.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">Payroll Table</div>
          <div className="mt-1 text-xs text-slate-500">
            Month {month}. Generate one employee at a time to prevent duplicate payroll runs.
          </div>
        </div>
        {reloading ? <ArrowPathIcon className="h-4 w-4 animate-spin text-slate-400" /> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-4">Employee Name</th>
              <th className="px-5 py-4">Employee ID</th>
              <th className="px-5 py-4">Month</th>
              <th className="px-5 py-4">Designation</th>
              <th className="px-5 py-4 text-right">Net Pay</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              const disableGenerate = item.status === "ZERO_SALARY" || Boolean(item.payroll);
              return (
                <tr key={item.employee.uid} className="hover:bg-slate-50/70">
                  <td className="px-5 py-4">
                    <div className="font-semibold text-slate-900">{item.employee.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.employee.department ?? "No department"}</div>
                  </td>
                  <td className="px-5 py-4 text-slate-700">{item.employee.employeeId}</td>
                  <td className="px-5 py-4 text-slate-700">{month}</td>
                  <td className="px-5 py-4 text-slate-700">{item.employee.designation ?? "-"}</td>
                  <td className="px-5 py-4 text-right font-semibold text-slate-900">
                    {item.payroll ? `INR ${Number(item.payroll.netPay ?? item.payroll.netSalary ?? 0).toLocaleString()}` : "-"}
                  </td>
                  <td className="px-5 py-4">
                    <div className="space-y-1">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClasses(item.status)}`}>
                        {item.status.replace(/_/g, " ")}
                      </span>
                      {item.issue ? (
                        <div className="text-xs text-rose-600">{item.issue}</div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      {!item.payroll ? (
                        <GeneratePayrollButton
                          employeeId={item.employee.employeeId}
                          month={month}
                          disabled={disableGenerate}
                          onSuccess={(payload) => {
                            onToast(
                              `Payroll generated for ${payload.employee.name}.`,
                              "success",
                            );
                            onGenerated();
                          }}
                          onError={(message) => onToast(message, "error")}
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onEdit(item)}
                            className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => onPreview(item)}
                            className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            Preview
                          </button>
                          <DownloadPayslipButton
                            payroll={item.payroll}
                            employee={item.employee}
                            onError={(message) => onToast(message, "error")}
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
