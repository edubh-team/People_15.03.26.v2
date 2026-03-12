import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, BanknotesIcon } from "@heroicons/react/24/outline";

interface Props {
  stats: {
    currentBalance: number;
    totalRevenue: number;
    totalExpense: number;
  };
  daily: {
    totalCreditToday: number;
    totalDebitToday: number;
  };
  onCardClick?: (view: "transactions" | "daily" | "payroll" | "approvals") => void;
}

const CARD_CLASS =
  "group relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 text-left shadow-sm transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60";

export default function StatsCards({ stats, daily, onCardClick }: Props) {
  return (
    <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
      <button type="button" onClick={() => onCardClick?.("transactions")} className={CARD_CLASS}>
        <div className="absolute -mr-4 -mt-4 right-0 top-0 h-24 w-24 rounded-full bg-indigo-50/50 blur-xl transition-colors group-hover:bg-indigo-100/50" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
              <BanknotesIcon className="h-6 w-6" />
            </div>
            <span className="text-sm font-medium text-slate-500">Current Balance</span>
          </div>
          <div className="text-3xl font-bold text-slate-900">Rs {stats.currentBalance.toLocaleString()}</div>
          <div className="mt-2 text-xs text-slate-400">Live company wallet</div>
        </div>
      </button>

      <button type="button" onClick={() => onCardClick?.("daily")} className={CARD_CLASS}>
        <div className="absolute -mr-4 -mt-4 right-0 top-0 h-24 w-24 rounded-full bg-emerald-50/50 blur-xl transition-colors group-hover:bg-emerald-100/50" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <ArrowTrendingUpIcon className="h-6 w-6" />
            </div>
            <span className="text-sm font-medium text-slate-500">Today Income</span>
          </div>
          <div className="text-3xl font-bold text-emerald-600">+Rs {daily.totalCreditToday.toLocaleString()}</div>
          <div className="mt-2 text-xs text-slate-400">Total revenue: Rs {stats.totalRevenue.toLocaleString()}</div>
        </div>
      </button>

      <button type="button" onClick={() => onCardClick?.("daily")} className={CARD_CLASS}>
        <div className="absolute -mr-4 -mt-4 right-0 top-0 h-24 w-24 rounded-full bg-rose-50/50 blur-xl transition-colors group-hover:bg-rose-100/50" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-lg bg-rose-50 p-2 text-rose-600">
              <ArrowTrendingDownIcon className="h-6 w-6" />
            </div>
            <span className="text-sm font-medium text-slate-500">Today Expense</span>
          </div>
          <div className="text-3xl font-bold text-rose-600">-Rs {daily.totalDebitToday.toLocaleString()}</div>
          <div className="mt-2 text-xs text-slate-400">Total spend: Rs {stats.totalExpense.toLocaleString()}</div>
        </div>
      </button>
    </div>
  );
}
