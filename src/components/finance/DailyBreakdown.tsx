import { FinanceDailyRecord } from "@/lib/types/finance";
import { format, parseISO } from "date-fns";

export default function DailyBreakdown({ records }: { records: FinanceDailyRecord[] }) {
  if (records.length === 0) {
    return (
      <div className="text-center py-10 text-slate-500 bg-white rounded-2xl border border-slate-100">
        No daily records found for this month.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 font-semibold text-slate-600">Date</th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right">Opening</th>
              <th className="px-6 py-4 font-semibold text-emerald-600 text-right">Total In</th>
              <th className="px-6 py-4 font-semibold text-rose-600 text-right">Total Out</th>
              <th className="px-6 py-4 font-semibold text-slate-900 text-right">Closing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {records.map((record) => (
              <tr key={record.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 font-medium text-slate-700">
                  {format(parseISO(record.date), "MMM d, yyyy")}
                </td>
                <td className="px-6 py-4 text-slate-500 text-right font-mono">
                  ₹{record.openingBalance.toLocaleString('en-IN')}
                </td>
                <td className="px-6 py-4 text-emerald-600 text-right font-mono font-medium">
                  +₹{record.totalCreditToday.toLocaleString('en-IN')}
                </td>
                <td className="px-6 py-4 text-rose-600 text-right font-mono font-medium">
                  -₹{record.totalDebitToday.toLocaleString('en-IN')}
                </td>
                <td className="px-6 py-4 text-slate-900 text-right font-mono font-bold">
                  ₹{record.closingBalance.toLocaleString('en-IN')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
