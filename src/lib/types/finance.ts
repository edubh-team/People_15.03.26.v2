export type TransactionType = 'CREDIT' | 'DEBIT';

export type TransactionCategory =
  | 'University Name'
  | 'Family Fund'
  | 'Investors Fund'
  | 'Donation'
  | 'Loan'
  | 'FREELANCER'
  | 'EMI'
  | 'MARKETING'
  | 'OFFICE EXPENSES'
  | 'Traveling Expenses'
  | 'Advance salary'
  | 'Bonus'
  // Legacy categories retained for backward compatibility with older ledger entries.
  | 'Revenue'
  | 'Investment'
  | 'Sales'
  | 'Rent'
  | 'Salaries'
  | 'Petty Cash'
  | 'Infra'
  | 'Marketing'
  | 'Others';

export type PaymentMode = 'NEFT' | 'RTGS' | 'IMPS' | 'UPI' | 'CREDIT' | 'CREDIT CARD' | 'LOAN' | 'CHEQUE' | 'CASH';

export interface FinanceTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: TransactionCategory;
  paymentMode?: PaymentMode;
  chequeNo?: string;
  remarks: string;
  proofUrl: string | null;
  transactionDate: unknown; // Timestamp
  performedBy: {
    uid: string;
    name: string;
    role: string;
  };
  toUser?: {
    id: string;
    name: string;
    type: 'EMPLOYEE' | 'EXTERNAL' | 'OTHER';
    otherDetails?: string; // For 'OTHER' specific details
  } | {
    id: string;
    name: string;
    type: 'EMPLOYEE' | 'EXTERNAL' | 'OTHER';
    otherDetails?: string;
  }[]; // Allow array for bulk (Salaries)
  salaryMonth?: string; // e.g. "January 2026"
  loanBankName?: string;
  loanInterestRate?: number; // percentage, e.g., 12.5
  runningBalanceAfter: number;
  approvalRequestId?: string | null;
  approvedBy?: FinanceActorRef | null;
  createdAt: unknown; // ServerTimestamp
}

export interface FinanceStats {
  currentBalance: number;
  totalRevenue: number;
  totalExpense: number;
  lastUpdated: unknown; // ServerTimestamp
}

export interface FinanceDailyRecord {
  id: string; // YYYY-MM-DD
  openingBalance: number;
  closingBalance: number;
  totalCreditToday: number;
  totalDebitToday: number;
  date: string;
}

export interface AccountPerson {
  id: string;
  name: string;
  phone: string;
  email: string;
  accountNumber: string;
  ifscCode: string;
  createdAt: unknown; // ServerTimestamp
  createdBy: string; // uid
  updatedAt?: unknown; // ServerTimestamp
  normalizedName?: string;
  normalizedEmail?: string;
  accountLast4?: string;
  isActive?: boolean;
}

export interface FinanceAccountDirectoryItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  accountNumber: string | null;
  accountNumberMasked: string | null;
  ifscCode: string | null;
  ifscCodeMasked: string | null;
  role: string;
  type: "EMPLOYEE" | "EXTERNAL";
  photoURL?: string | null;
  employeeId?: string | null;
  hasSensitiveData: boolean;
}

export interface FinanceAccountDirectoryResponse {
  items: FinanceAccountDirectoryItem[];
  summary: {
    total: number;
    employees: number;
    external: number;
    withSensitiveData: number;
  };
}

export interface FinanceActorRef {
  uid: string;
  name: string;
  role: string;
}

export interface FinanceTransactionDraft {
  type: TransactionType;
  amount: number;
  category: TransactionCategory;
  paymentMode?: PaymentMode;
  chequeNo?: string | null;
  dateInput?: string | null;
  remarks: string;
  proofUrl: string | null;
  toUser?: FinanceTransaction["toUser"] | null;
  salaryMonth?: string | null;
  loanBankName?: string | null;
  loanInterestRate?: number | null;
}

export type FinanceApprovalAction = "CREATE_TRANSACTION" | "DELETE_TRANSACTION";
export type FinanceApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface FinanceApprovalPolicySummary {
  enabled: boolean;
  deleteRequiresApproval: boolean;
  requireAllDebits: boolean;
  minimumAmount: number;
  sensitiveCategories: TransactionCategory[];
}

export interface FinanceApprovalListItem {
  id: string;
  action: FinanceApprovalAction;
  status: FinanceApprovalStatus;
  summary: string;
  requestReason: string | null;
  decisionReason: string | null;
  requestedBy: FinanceActorRef;
  reviewedBy: FinanceActorRef | null;
  transactionDraft: FinanceTransactionDraft | null;
  existingTransactionId: string | null;
  existingTransactionSummary: string | null;
  appliedTransactionId: string | null;
  canReview: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  decidedAt: string | null;
}

export interface FinanceAuditEvent {
  id: string;
  eventType: string;
  action: string;
  summary: string;
  actor: FinanceActorRef;
  approvalRequestId?: string | null;
  transactionId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string | null;
}

export interface FinanceApprovalListResponse {
  items: FinanceApprovalListItem[];
  recentEvents: FinanceAuditEvent[];
  summary: {
    pending: number;
    approved: number;
    rejected: number;
  };
  policy: FinanceApprovalPolicySummary;
}

export interface FinanceTransactionMutationResponse {
  success: true;
  status: "applied" | "pending_approval";
  id?: string;
  approvalRequestId?: string;
  message?: string;
}
