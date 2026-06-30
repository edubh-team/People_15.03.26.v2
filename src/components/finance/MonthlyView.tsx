import { FinanceDailyRecord } from "@/lib/types/finance";

export default function MonthlyView({ records }: { records: FinanceDailyRecord[] }) {
  const totalCredit = records.reduce((sum, r) => sum + r.totalCreditToday, 0);
  const totalDebit = records.reduce((sum, r) => sum + r.totalDebitToday, 0);
  const net = totalCredit - totalDebit;

  const maxVal = Math.max(totalCredit, totalDebit) || 1; // avoid div by zero

  const creditWidth = (totalCredit / maxVal) * 100;
  const debitWidth = (totalDebit / maxVal) * 100;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Visual Breakdown */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-center">
        <h3 className="text-sm font-semibold text-slate-500 mb-6 uppercase tracking-wider">Monthly Performance</h3>
        
        <div className="space-y-6">
          {/* Credit Bar */}
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-slate-700">Total Income</span>
              <span className="font-bold text-emerald-600">₹{totalCredit.toLocaleString('en-IN')}</span>
            </div>
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-500 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${creditWidth}%` }}
              />
            </div>
          </div>

          {/* Debit Bar */}
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-slate-700">Total Expenses</span>
              <span className="font-bold text-rose-600">₹{totalDebit.toLocaleString('en-IN')}</span>
            </div>
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-rose-500 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${debitWidth}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Net Summary */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center text-center">
        <h3 className="text-sm font-semibold text-slate-500 mb-2 uppercase tracking-wider">Net Flow (This Month)</h3>
        <div className={`text-4xl font-bold mb-2 ${net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {net >= 0 ? '+' : ''}₹{net.toLocaleString('en-IN')}
        </div>
        <p className="text-slate-400 text-sm">
          {net >= 0 ? "Healthy surplus maintained." : "Expenses exceeding income."}
        </p>
      </div>
    </div>
  );
}
