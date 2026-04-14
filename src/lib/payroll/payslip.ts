import type {
  Payroll,
  PayrollDeductionsBreakdown,
  PayrollEarningsBreakdown,
  PayrollLineItem,
} from "@/lib/types/hr";

type PayslipEmployeeInput = {
  name: string;
  employeeId: string;
  designation?: string | null;
  department?: string | null;
};

type PayslipModelInput = {
  employee: PayslipEmployeeInput;
  payroll: Payroll;
};

export type PayslipLineRow = {
  label: string;
  amount: number;
};

export type PayslipPreviewModel = {
  companyName: string;
  tagline: string;
  logoPath: string;
  employeeName: string;
  employeeId: string;
  designation: string;
  department: string;
  paymentPeriodLabel: string;
  paymentDateLabel: string;
  earningsRows: PayslipLineRow[];
  deductionRows: PayslipLineRow[];
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  netPayFormula: string;
  netPaySummaryLine: string;
  filename: string;
  month: string;
};

export const PAYSLIP_BRANDING = {
  companyName: "EduBh",
  tagline: "Learning. Careers. Growth.",
  logoPath: "/assets/edubh-payslip-logo.png",
} as const;

const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function toAmount(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

function toKey(label: string) {
  return label.trim().toLowerCase();
}

function buildMonthBoundaries(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 1 || monthIndex > 12) {
    return null;
  }

  const previousMonth = monthIndex === 1 ? 12 : monthIndex - 1;
  const previousYear = monthIndex === 1 ? year - 1 : year;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  const nextYear = monthIndex === 12 ? year + 1 : year;

  return {
    start: `${previousYear}-${String(previousMonth).padStart(2, "0")}-25`,
    end: `${month}-25`,
    paymentDate: `${nextYear}-${String(nextMonth).padStart(2, "0")}-02`,
  };
}

function parseDateValue(value: string | null | undefined) {
  if (!value) return null;

  const source = value.includes("T") ? value : `${value}T00:00:00Z`;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getOrdinalSuffix(day: number) {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return "th";

  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function formatInr(value: number) {
  return currencyFormatter.format(toAmount(value));
}

export function formatInrNumber(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(toAmount(value));
}

export function formatPayslipDate(value: string | null | undefined, style: "long" | "short" = "long") {
  const parsed = parseDateValue(value);
  if (!parsed) return "-";

  const monthName = style === "short" ? SHORT_MONTHS[parsed.getUTCMonth()] : LONG_MONTHS[parsed.getUTCMonth()];
  const day = parsed.getUTCDate();
  return `${day}${getOrdinalSuffix(day)} ${monthName} ${parsed.getUTCFullYear()}`;
}

export function formatPaymentPeriod(
  start: string | null | undefined,
  end: string | null | undefined,
  month: string,
) {
  const boundaries = buildMonthBoundaries(month);
  const startValue = start ?? boundaries?.start ?? null;
  const endValue = end ?? boundaries?.end ?? null;

  return `${formatPayslipDate(startValue, "long")} to ${formatPayslipDate(endValue, "long")}`;
}

export function getDefaultPayrollCycle(month: string) {
  return buildMonthBoundaries(month);
}

function readLineItemAmount(items: PayrollLineItem[] | undefined, labels: string[]) {
  if (!items) return 0;
  const index = new Set(labels.map(toKey));
  return items.reduce((sum, item) => {
    return index.has(toKey(item.label)) ? sum + toAmount(item.amount) : sum;
  }, 0);
}

export function getPayrollEarningsBreakdown(payroll: Payroll): PayrollEarningsBreakdown {
  const structured = !Array.isArray(payroll.earnings) ? payroll.earnings : undefined;
  const items = Array.isArray(payroll.earnings) ? payroll.earnings : undefined;

  return {
    basicSalary: toAmount(
      structured?.basicSalary ?? payroll.basicSalary ?? payroll.baseSalary ?? readLineItemAmount(items, ["basic salary"]),
    ),
    studyAllowance: toAmount(
      structured?.studyAllowance ?? readLineItemAmount(items, ["study allowance"]),
    ),
    bonus: toAmount(
      structured?.bonus ??
        payroll.bonus ??
        payroll.bonuses ??
        payroll.incentives ??
        readLineItemAmount(items, ["performance bonus", "bonus"]),
    ),
    hra: toAmount(
      structured?.hra ?? readLineItemAmount(items, ["house rent allowance", "hra"]),
    ),
  };
}

export function getPayrollDeductionsBreakdown(payroll: Payroll): PayrollDeductionsBreakdown {
  const legacyTotal = toAmount(payroll.deductions);
  const structured = payroll.deductionBreakdown;
  const items = payroll.deductionItems;
  const professionalTax = toAmount(
    structured?.professionalTax ?? readLineItemAmount(items, ["professional tax", "pt"]),
  );
  const pf = toAmount(structured?.pf ?? readLineItemAmount(items, ["pf", "provident fund"]));
  const insurance = toAmount(
    structured?.insurance ?? readLineItemAmount(items, ["health insurance", "insurance"]),
  );
  const explicitLop = toAmount(
    structured?.lop ?? readLineItemAmount(items, ["lop", "loss of pay", "absent deduction"]),
  );
  const lop = Math.max(explicitLop, legacyTotal - professionalTax - pf - insurance);

  return {
    lop,
    professionalTax,
    pf,
    insurance,
  };
}

export function normalizePayrollRecord(payroll: Payroll): Payroll {
  const defaultCycle = getDefaultPayrollCycle(payroll.month);
  const earnings = getPayrollEarningsBreakdown(payroll);
  const deductionBreakdown = getPayrollDeductionsBreakdown(payroll);
  const totalEarnings = Object.values(earnings).reduce((sum, value) => sum + value, 0);
  const totalDeductions = Object.values(deductionBreakdown).reduce((sum, value) => sum + value, 0);
  const netPay = toAmount(payroll.netPay ?? payroll.netSalary ?? totalEarnings - totalDeductions);

  return {
    ...payroll,
    earnings,
    deductionBreakdown,
    deductions: totalDeductions,
    grossSalary: totalEarnings,
    netPay,
    netSalary: netPay,
    paymentPeriodStart: payroll.paymentPeriodStart ?? defaultCycle?.start ?? null,
    paymentPeriodEnd: payroll.paymentPeriodEnd ?? defaultCycle?.end ?? null,
    paymentDate: payroll.paymentDate ?? defaultCycle?.paymentDate ?? null,
  };
}

export function buildPayslipPreviewModel(input: PayslipModelInput): PayslipPreviewModel {
  const payroll = normalizePayrollRecord(input.payroll);
  const earnings = getPayrollEarningsBreakdown(payroll);
  const deductions = getPayrollDeductionsBreakdown(payroll);
  const earningsRows: PayslipLineRow[] = [
    { label: "Basic Salary", amount: earnings.basicSalary },
    { label: "Study allowance", amount: earnings.studyAllowance },
    { label: "Performance Bonus", amount: earnings.bonus },
    { label: "House Rent Allowance", amount: earnings.hra },
  ];
  const deductionRows: PayslipLineRow[] = [
    { label: "LOP", amount: deductions.lop },
    { label: "Professional Tax", amount: deductions.professionalTax },
    { label: "PF", amount: deductions.pf },
    { label: "Health Insurance", amount: deductions.insurance },
  ];

  const totalEarnings = earningsRows.reduce((sum, row) => sum + row.amount, 0);
  const totalDeductions = deductionRows.reduce((sum, row) => sum + row.amount, 0);
  const employeeId = input.employee.employeeId || payroll.employeeId || payroll.uid;
  const netPay = toAmount(payroll.netPay ?? payroll.netSalary ?? totalEarnings - totalDeductions);

  return {
    ...PAYSLIP_BRANDING,
    employeeName: input.employee.name,
    employeeId,
    designation: input.employee.designation?.trim() || payroll.designation?.trim() || "-",
    department: input.employee.department?.trim() || payroll.department?.trim() || "-",
    paymentPeriodLabel: formatPaymentPeriod(
      payroll.paymentPeriodStart,
      payroll.paymentPeriodEnd,
      payroll.month,
    ),
    paymentDateLabel: formatPayslipDate(payroll.paymentDate, "long"),
    earningsRows,
    deductionRows,
    totalEarnings,
    totalDeductions,
    netPay,
    netPayFormula: `(${formatInrNumber(totalEarnings)} INR - ${formatInrNumber(totalDeductions)} INR) = ${formatInrNumber(netPay)} INR`,
    netPaySummaryLine: `Total Net Pay: (Total Earnings - Total Deductions) = (${formatInrNumber(totalEarnings)} INR - ${formatInrNumber(totalDeductions)} INR) = ${formatInrNumber(netPay)} INR`,
    filename: `payslip_${employeeId}_${payroll.month}.pdf`,
    month: payroll.month,
  };
}
