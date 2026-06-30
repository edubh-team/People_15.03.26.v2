"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase/client";
import { collection, doc, onSnapshot, query, orderBy, limit, where } from "firebase/firestore";
import { getTodayKey } from "@/lib/finance/dailyLedgerService";
import {
  FinanceStats,
  FinanceDailyRecord,
  FinanceTransaction,
  FinanceTransactionMutationResponse,
} from "@/lib/types/finance";
import { startOfMonth, format } from "date-fns";
import StatsCards from "./StatsCards";
import LedgerTable from "./LedgerTable";
import TransactionModal from "./TransactionModal";
import MonthlyView from "./MonthlyView";
import DailyBreakdown from "./DailyBreakdown";
import PayrollView from "./PayrollView";
import FinanceApprovalsPanel from "./FinanceApprovalsPanel";
import {
  PlusIcon,
  TableCellsIcon,
  CalendarDaysIcon,
  BanknotesIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";

export default function FinanceDashboard() {
  const [stats, setStats] = useState<FinanceStats>({
    currentBalance: 0,
    totalRevenue: 0,
    totalExpense: 0,
    lastUpdated: null,
  });
  
  const [daily, setDaily] = useState<FinanceDailyRecord>({
    id: "",
    openingBalance: 0,
    closingBalance: 0,
    totalCreditToday: 0,
    totalDebitToday: 0,
    date: "",
  });

  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [monthlyRecords, setMonthlyRecords] = useState<FinanceDailyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<
    "transactions" | "daily" | "payroll" | "approvals"
  >("transactions");
  const [refreshApprovalsKey, setRefreshApprovalsKey] = useState(0);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "success" | "info" | "error";
  } | null>(null);

  useEffect(() => {
    if (!db) return;

    // 1. Subscribe to Global Stats
    const unsubStats = onSnapshot(doc(db, "finance_stats", "global_stats"), (doc) => {
      if (doc.exists()) {
        setStats(doc.data() as FinanceStats);
      }
    });

    // 2. Subscribe to Daily Record (Today)
    const todayKey = getTodayKey();
    const unsubDaily = onSnapshot(doc(db, "finance_daily_records", todayKey), (doc) => {
      if (doc.exists()) {
        setDaily(doc.data() as FinanceDailyRecord);
      } else {
        setDaily({
            id: todayKey,
            openingBalance: 0,
            closingBalance: 0,
            totalCreditToday: 0,
            totalDebitToday: 0,
            date: todayKey,
        });
      }
    });

    // 3. Subscribe to Monthly Records (For Reporting)
    const startOfMonthStr = format(startOfMonth(new Date()), "yyyy-MM-dd");
    const qMonthly = query(
      collection(db, "finance_daily_records"), 
      where("date", ">=", startOfMonthStr),
      orderBy("date", "desc")
    );
    const unsubMonthly = onSnapshot(qMonthly, (snapshot) => {
      const data = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as FinanceDailyRecord));
      setMonthlyRecords(data);
    });

    // 4. Subscribe to Transactions (Recent 50)
    const qTx = query(collection(db, "finance_transactions"), orderBy("transactionDate", "desc"), limit(50));
    const unsubTx = onSnapshot(qTx, (snapshot) => {
      const data = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as FinanceTransaction));
      setTransactions(data);
      setLoading(false);
    });

    return () => {
      unsubStats();
      unsubDaily();
      unsubMonthly();
      unsubTx();
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 md:p-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Finance Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Commercial Ledger & Real-time Analytics</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-xl font-medium shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all active:scale-95"
        >
          <PlusIcon className="h-5 w-5" />
          Add Entry
        </button>
      </div>

      <StatsCards stats={stats} daily={daily} onCardClick={(nextView) => setViewMode(nextView)} />

      <MonthlyView records={monthlyRecords} />

      {notice ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
            notice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : notice.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-indigo-200 bg-indigo-50 text-indigo-700"
          }`}
        >
          {notice.message}
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            {viewMode === "transactions"
              ? "Recent Transactions"
              : viewMode === "daily"
                ? "Daily Breakdown"
                : viewMode === "payroll"
                  ? "Payroll Management"
                  : "Finance Controls"}
          </h2>
          <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
            <button
              onClick={() => setViewMode('transactions')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'transactions' 
                  ? 'bg-slate-100 text-slate-900 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <TableCellsIcon className="h-4 w-4" />
              Ledger
            </button>
            <button
              onClick={() => setViewMode('daily')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'daily' 
                  ? 'bg-slate-100 text-slate-900 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <CalendarDaysIcon className="h-4 w-4" />
              Daily View
            </button>
            <button
              onClick={() => setViewMode('payroll')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'payroll' 
                  ? 'bg-slate-100 text-slate-900 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <BanknotesIcon className="h-4 w-4" />
              Payroll
            </button>
            <button
              onClick={() => setViewMode("approvals")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === "approvals"
                  ? "bg-slate-100 text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <ShieldCheckIcon className="h-4 w-4" />
              Controls
            </button>
          </div>
        </div>

        {loading ? (
          <div className="h-64 rounded-2xl bg-white border border-slate-100 animate-pulse" />
        ) : viewMode === "transactions" ? (
          <LedgerTable
            transactions={transactions}
            currentBalance={stats.currentBalance}
            onAction={(message, tone = "info") => setNotice({ message, tone })}
          />
        ) : viewMode === "daily" ? (
          <DailyBreakdown records={monthlyRecords} />
        ) : viewMode === "payroll" ? (
          <PayrollView />
        ) : (
          <FinanceApprovalsPanel
            refreshKey={refreshApprovalsKey}
            onAction={(message, tone = "info") => {
              setNotice({ message, tone });
              setRefreshApprovalsKey((current) => current + 1);
            }}
          />
        )}
      </div>

      <TransactionModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        onSuccess={(result?: FinanceTransactionMutationResponse) => {
          if (!result) return;

          if (result.status === "pending_approval") {
            setNotice({
              message: result.message || "Transaction submitted for approval.",
              tone: "info",
            });
            setViewMode("approvals");
            setRefreshApprovalsKey((current) => current + 1);
            return;
          }

          setNotice({
            message: result.message || "Transaction recorded successfully.",
            tone: "success",
          });
        }}
      />
    </div>
  );
}
