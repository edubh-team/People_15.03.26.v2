import type { FinanceApprovalPolicySummary, TransactionCategory, TransactionType } from "@/lib/types/finance";

const DEFAULT_SENSITIVE_CATEGORIES: TransactionCategory[] = [
  "Advance salary",
  "Bonus",
  "FREELANCER",
  "Loan",
  "EMI",
  "MARKETING",
];

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function readNumberEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readCategoriesEnv(): TransactionCategory[] {
  const raw = process.env.FINANCE_APPROVAL_CATEGORIES?.trim();
  if (!raw) return DEFAULT_SENSITIVE_CATEGORIES;

  const requested = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const valid = requested.filter(
    (value): value is TransactionCategory =>
      [
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
      ].includes(value),
  );

  return valid.length > 0 ? valid : DEFAULT_SENSITIVE_CATEGORIES;
}

export function getFinanceApprovalPolicy(): FinanceApprovalPolicySummary {
  const enabled = readBooleanEnv("FINANCE_MAKER_CHECKER_ENABLED", false);

  return {
    enabled,
    deleteRequiresApproval: enabled
      ? readBooleanEnv("FINANCE_DELETE_REQUIRES_APPROVAL", true)
      : false,
    requireAllDebits: enabled
      ? readBooleanEnv("FINANCE_APPROVAL_ALL_DEBITS", false)
      : false,
    minimumAmount: enabled ? readNumberEnv("FINANCE_APPROVAL_MIN_AMOUNT", 50000) : 0,
    sensitiveCategories: enabled ? readCategoriesEnv() : [],
  };
}

export function shouldRequireFinanceApproval(input: {
  type: TransactionType;
  amount: number;
  category: TransactionCategory;
}) {
  const policy = getFinanceApprovalPolicy();
  if (!policy.enabled) return false;

  return (
    input.amount >= policy.minimumAmount ||
    policy.sensitiveCategories.includes(input.category) ||
    (policy.requireAllDebits && input.type === "DEBIT")
  );
}
