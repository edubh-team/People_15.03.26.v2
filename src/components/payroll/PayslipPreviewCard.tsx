"use client";

import { buildPayslipPreviewModel, formatInrNumber } from "@/lib/payroll/payslip";
import type { Payroll } from "@/lib/types/hr";

type Props = {
  payroll: Payroll;
  employee: {
    name: string;
    employeeId: string;
    designation?: string | null;
    department?: string | null;
  };
};

export default function PayslipPreviewCard({ payroll, employee }: Props) {
  const payslip = buildPayslipPreviewModel({
    employee,
    payroll,
  });

  return (
    <div className="mx-auto w-full max-w-[980px] rounded-[24px] border border-slate-300 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.10)]">
      <div className="border-b border-slate-300 px-8 py-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-4">
            <img
              src={payslip.logoPath}
              alt="EduBh logo"
              className="h-20 w-auto max-w-[360px] object-contain"
            />
          </div>

          <div className="max-w-[520px] text-left lg:text-right">
            <div className="text-base font-medium leading-7 text-slate-900">{payslip.netPaySummaryLine}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 border-b border-slate-300 px-8 py-5 lg:grid-cols-2">
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Employee Name:</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{payslip.employeeName}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Designation:</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{payslip.designation}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Employee ID:</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{payslip.employeeId}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Department:</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{payslip.department}</div>
          </div>
        </div>

        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Payment Period:</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{payslip.paymentPeriodLabel}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Payment Date:</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{payslip.paymentDateLabel}</div>
          </div>
        </div>
      </div>

      <div className="px-8 py-5">
        <div className="overflow-hidden rounded-2xl border border-slate-300">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                <th className="border-b border-slate-200 px-4 py-3">Earnings</th>
                <th className="border-b border-slate-200 px-4 py-3 text-right">Amount(in INR)</th>
                <th className="border-b border-slate-200 px-4 py-3">Deductions</th>
                <th className="border-b border-slate-200 px-4 py-3 text-right">Amount(in INR)</th>
              </tr>
            </thead>
            <tbody>
              {payslip.earningsRows.map((earning, index) => (
                <tr key={earning.label} className="odd:bg-white even:bg-slate-50/60">
                  <td className="border-b border-slate-200 px-4 py-3 text-slate-700">{earning.label}</td>
                  <td className="border-b border-slate-200 px-4 py-3 text-right font-medium text-slate-900">
                    {formatInrNumber(earning.amount)}
                  </td>
                  <td className="border-b border-slate-200 px-4 py-3 text-slate-700">
                    {payslip.deductionRows[index]?.label}
                  </td>
                  <td className="border-b border-slate-200 px-4 py-3 text-right font-medium text-slate-900">
                    {formatInrNumber(payslip.deductionRows[index]?.amount ?? 0)}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-100">
                <td className="px-4 py-3 font-semibold text-slate-950">Total</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-950">
                  {formatInrNumber(payslip.totalEarnings)}
                </td>
                <td className="px-4 py-3 font-semibold text-slate-950">Total</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-950">
                  {formatInrNumber(payslip.totalDeductions)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-5 text-center text-sm text-slate-500">
          This is a computer-generated slip no need of any signature
        </div>
      </div>
    </div>
  );
}
