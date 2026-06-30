import { format } from "date-fns";

export function getTodayKey(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function getYesterdayKey(date: Date = new Date()): string {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  return format(yesterday, "yyyy-MM-dd");
}

export function calculateNewStats(
  currentStats: { totalRevenue: number; totalExpense: number; currentBalance: number },
  amount: number,
  type: 'CREDIT' | 'DEBIT'
) {
  const isCredit = type === 'CREDIT';
  
  const newRevenue = isCredit ? currentStats.totalRevenue + amount : currentStats.totalRevenue;
  const newExpense = !isCredit ? currentStats.totalExpense + amount : currentStats.totalExpense;
  const newBalance = isCredit ? currentStats.currentBalance + amount : currentStats.currentBalance - amount;

  return { newRevenue, newExpense, newBalance };
}
