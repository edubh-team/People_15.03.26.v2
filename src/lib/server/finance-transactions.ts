import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { calculateNewStats, getTodayKey } from "@/lib/finance/dailyLedgerService";
import type {
  FinanceActorRef,
  FinanceTransactionDraft,
  PaymentMode,
  TransactionCategory,
  TransactionType,
} from "@/lib/types/finance";

const VALID_CATEGORIES = new Set<TransactionCategory>([
  "University Name",
  "Family Fund",
  "Investors Fund",
  "Donation",
  "Revenue",
  "Investment",
  "Loan",
  "Sales",
  "Rent",
  "Salaries",
  "Petty Cash",
  "Infra",
  "FREELANCER",
  "EMI",
  "MARKETING",
  "OFFICE EXPENSES",
  "Traveling Expenses",
  "Advance salary",
  "Bonus",
  "Marketing",
  "Others",
]);

const VALID_PAYMENT_MODES = new Set<PaymentMode>([
  "NEFT",
  "RTGS",
  "IMPS",
  "UPI",
  "CREDIT",
  "CREDIT CARD",
  "LOAN",
  "CHEQUE",
  "CASH",
]);

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(amount);
}

function normalizeDateInput(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid transaction date");
  }

  return parsed.toISOString().slice(0, 10);
}

function toTransactionTimestamp(dateInput?: string | null) {
  if (!dateInput) return FieldValue.serverTimestamp();

  const date = new Date(dateInput);
  date.setUTCHours(12, 0, 0, 0);
  return Timestamp.fromDate(date);
}

export function normalizeFinanceTransactionInput(body: Record<string, unknown>): FinanceTransactionDraft {
  const type = body.type;
  const amount = Number(body.amount);
  const category = body.category;
  const paymentMode = body.paymentMode ?? "NEFT";

  if (type !== "CREDIT" && type !== "DEBIT") {
    throw new Error("Invalid transaction type");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive number");
  }

  if (typeof category !== "string" || !VALID_CATEGORIES.has(category as TransactionCategory)) {
    throw new Error("Invalid transaction category");
  }

  if (
    typeof paymentMode !== "string" ||
    !VALID_PAYMENT_MODES.has(paymentMode as PaymentMode)
  ) {
    throw new Error("Invalid payment mode");
  }

  const chequeNo =
    typeof body.chequeNo === "string" && body.chequeNo.trim()
      ? body.chequeNo.trim()
      : null;

  if (paymentMode === "CHEQUE" && !chequeNo) {
    throw new Error("Cheque Number is required for Cheque payments");
  }

  const loanInterestRate =
    typeof body.loanInterestRate === "number"
      ? body.loanInterestRate
      : typeof body.loanInterestRate === "string" && body.loanInterestRate.trim()
        ? Number(body.loanInterestRate)
        : null;

  if (loanInterestRate != null && (!Number.isFinite(loanInterestRate) || loanInterestRate < 0)) {
    throw new Error("Invalid loan interest rate");
  }

  return {
    type: type as TransactionType,
    amount,
    category: category as TransactionCategory,
    paymentMode: paymentMode as PaymentMode,
    chequeNo,
    dateInput: normalizeDateInput(body.date),
    remarks: typeof body.remarks === "string" ? body.remarks.trim() : "",
    proofUrl: typeof body.proofUrl === "string" && body.proofUrl.trim() ? body.proofUrl.trim() : null,
    toUser: (body.toUser as FinanceTransactionDraft["toUser"]) ?? null,
    salaryMonth:
      typeof body.salaryMonth === "string" && body.salaryMonth.trim()
        ? body.salaryMonth.trim()
        : null,
    loanBankName:
      typeof body.loanBankName === "string" && body.loanBankName.trim()
        ? body.loanBankName.trim()
        : null,
    loanInterestRate,
  };
}

export function buildFinanceTransactionSummary(input: {
  type: TransactionType;
  amount: number;
  category: TransactionCategory;
}) {
  const direction = input.type === "CREDIT" ? "Credit" : "Debit";
  return `${direction} of Rs ${formatCurrency(input.amount)} for ${input.category}`;
}

function toDateKey(rawDate: unknown) {
  let date = new Date();

  if (rawDate instanceof Timestamp) {
    date = rawDate.toDate();
  } else if (
    typeof rawDate === "object" &&
    rawDate !== null &&
    "toDate" in rawDate &&
    typeof (rawDate as { toDate: () => Date }).toDate === "function"
  ) {
    date = (rawDate as { toDate: () => Date }).toDate();
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function applyFinanceTransaction(
  adminDb: Firestore,
  draft: FinanceTransactionDraft,
  performedBy: FinanceActorRef,
  options?: {
    approvalRequestId?: string | null;
    approvedBy?: FinanceActorRef | null;
  },
) {
  const todayKey = getTodayKey();
  const statsRef = adminDb.collection("finance_stats").doc("global_stats");
  const dailyRef = adminDb.collection("finance_daily_records").doc(todayKey);
  const txRef = adminDb.collection("finance_transactions").doc();

  let appliedBalance = 0;

  await adminDb.runTransaction(async (transaction) => {
    const statsDoc = await transaction.get(statsRef);
    const dailyDoc = await transaction.get(dailyRef);

    let currentStats = {
      currentBalance: 0,
      totalRevenue: 0,
      totalExpense: 0,
    };

    if (statsDoc.exists) {
      currentStats = statsDoc.data() as typeof currentStats;
    }

    const { newBalance, newRevenue, newExpense } = calculateNewStats(
      currentStats,
      draft.amount,
      draft.type,
    );

    if (draft.type === "DEBIT" && newBalance < 0) {
      throw new Error("Insufficient Funds: Cannot debit more than current balance.");
    }

    let dailyData = {
      openingBalance: 0,
      closingBalance: 0,
      totalCreditToday: 0,
      totalDebitToday: 0,
      date: todayKey,
    };

    if (dailyDoc.exists) {
      dailyData = dailyDoc.data() as typeof dailyData;
    } else {
      dailyData.openingBalance = currentStats.currentBalance;
    }

    if (draft.type === "CREDIT") {
      dailyData.totalCreditToday += draft.amount;
    } else {
      dailyData.totalDebitToday += draft.amount;
    }

    dailyData.closingBalance =
      dailyData.openingBalance + dailyData.totalCreditToday - dailyData.totalDebitToday;

    transaction.set(
      statsRef,
      {
        currentBalance: newBalance,
        totalRevenue: newRevenue,
        totalExpense: newExpense,
        lastUpdated: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    transaction.set(dailyRef, dailyData, { merge: true });
    transaction.set(txRef, {
      type: draft.type,
      amount: draft.amount,
      category: draft.category,
      paymentMode: draft.paymentMode ?? "NEFT",
      chequeNo: draft.chequeNo ?? null,
      remarks: draft.remarks,
      proofUrl: draft.proofUrl ?? null,
      toUser: draft.toUser ?? null,
      salaryMonth: draft.salaryMonth ?? null,
      loanBankName: draft.loanBankName ?? null,
      loanInterestRate: draft.loanInterestRate ?? null,
      transactionDate: toTransactionTimestamp(draft.dateInput),
      performedBy,
      approvedBy: options?.approvedBy ?? null,
      approvalRequestId: options?.approvalRequestId ?? null,
      runningBalanceAfter: newBalance,
      createdAt: FieldValue.serverTimestamp(),
    });

    appliedBalance = newBalance;
  });

  return {
    transactionId: txRef.id,
    runningBalanceAfter: appliedBalance,
    summary: buildFinanceTransactionSummary(draft),
  };
}

export async function deleteFinanceTransaction(
  adminDb: Firestore,
  transactionId: string,
) {
  const txRef = adminDb.collection("finance_transactions").doc(transactionId);
  const txSnap = await txRef.get();

  if (!txSnap.exists) {
    throw new Error("Transaction not found");
  }

  const tx = txSnap.data() as Record<string, unknown>;
  const amount = Number(tx.amount) || 0;
  const type = tx.type as TransactionType;

  if (!amount || (type !== "CREDIT" && type !== "DEBIT")) {
    throw new Error("Invalid transaction data");
  }

  const dateKey = toDateKey(tx.transactionDate);
  const statsRef = adminDb.collection("finance_stats").doc("global_stats");
  const dailyRef = adminDb.collection("finance_daily_records").doc(dateKey);

  let appliedBalance = 0;

  await adminDb.runTransaction(async (transaction) => {
    const statsDoc = await transaction.get(statsRef);
    const dailyDoc = await transaction.get(dailyRef);

    let currentStats = {
      currentBalance: 0,
      totalRevenue: 0,
      totalExpense: 0,
    };

    if (statsDoc.exists) {
      currentStats = statsDoc.data() as typeof currentStats;
    }

    const { newBalance, newRevenue, newExpense } = calculateNewStats(
      currentStats,
      -amount,
      type,
    );

    let dailyData = {
      openingBalance: 0,
      closingBalance: 0,
      totalCreditToday: 0,
      totalDebitToday: 0,
      date: dateKey,
    };

    if (dailyDoc.exists) {
      dailyData = dailyDoc.data() as typeof dailyData;
    }

    if (type === "CREDIT") {
      dailyData.totalCreditToday = Math.max(0, (dailyData.totalCreditToday || 0) - amount);
    } else {
      dailyData.totalDebitToday = Math.max(0, (dailyData.totalDebitToday || 0) - amount);
    }

    dailyData.closingBalance =
      dailyData.openingBalance + dailyData.totalCreditToday - dailyData.totalDebitToday;

    transaction.set(
      statsRef,
      {
        currentBalance: newBalance,
        totalRevenue: newRevenue,
        totalExpense: newExpense,
        lastUpdated: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    transaction.set(dailyRef, dailyData, { merge: true });
    transaction.delete(txRef);

    appliedBalance = newBalance;
  });

  return {
    deletedId: transactionId,
    deletedTransaction: tx,
    runningBalanceAfter: appliedBalance,
    summary: buildFinanceTransactionSummary({
      type,
      amount,
      category: tx.category as TransactionCategory,
    }),
  };
}
