"use client";

import type { PayrollListResponse } from "@/lib/types/payroll";

type Props = {
  summary: PayrollListResponse["summary"];
  loading?: boolean;
};

const cards = [
  {
    key: "totalEmployees",
    label: "Total Employees",
    tone: "bg-slate-100 text-slate-800",
    format: (value: number) => value.toLocaleString(),
  },
  {
    key: "totalPayout",
    label: "Total Payout",
    tone: "bg-emerald-100 text-emerald-800",
    format: (value: number) => `INR ${value.toLocaleString()}`,
  },
  {
    key: "payrollRecords",
    label: "Payroll Records",
    tone: "bg-indigo-100 text-indigo-800",
    format: (value: number) => value.toLocaleString(),
  },
  {
    key: "drafts",
    label: "Drafts",
    tone: "bg-amber-100 text-amber-800",
    format: (value: number) => value.toLocaleString(),
  },
  {
    key: "sent",
    label: "Sent",
    tone: "bg-sky-100 text-sky-800",
    format: (value: number) => value.toLocaleString(),
  },
] as const;

export default function PayrollDashboardCards({ summary, loading = false }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.key}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {card.label}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-2xl font-semibold text-slate-900">
              {loading ? "..." : card.format(summary[card.key])}
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${card.tone}`}>
              Live
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
