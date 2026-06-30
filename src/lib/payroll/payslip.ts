import type {
  Payroll,
  PayrollDeductionsBreakdown,
  PayrollEarningsBreakdown,
  PayrollLineItem,
} from "@/lib/types/hr";
import type { PayrollSalaryBreakdown } from "@/lib/types/payroll";

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

export type PayslipDetailRow = {
  label: string;
  value: string;
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
  attendanceRows: PayslipDetailRow[];
  earningsRows: PayslipLineRow[];
  deductionRows: PayslipLineRow[];
  totalEarnings: number;
  totalDeductions: number;
  computedNetPay: number;
  netPay: number;
  hasNetPayOverride: boolean;
  netPayFormula: string;
  netPaySummaryLine: string;
  filename: string;
  month: string;
  monthLabel: string;
  statusLabel: string;
  signatureLabel: string;
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

function formatWholeNumber(value: unknown) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(toAmount(value));
}

function formatMonthLabel(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 1 || monthIndex > 12) {
    return month;
  }
  return `${LONG_MONTHS[monthIndex - 1]} ${year}`;
}

function formatDurationMinutes(value: unknown) {
  const minutes = Math.max(0, Number(value) || 0);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
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

function getStructuredSalaryBreakdown(payroll: Payroll) {
  const salaryBreakdown = (payroll as Payroll & { salaryBreakdown?: PayrollSalaryBreakdown }).salaryBreakdown;
  return salaryBreakdown ?? null;
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
  const salaryBreakdown = getStructuredSalaryBreakdown(input.payroll) ?? getStructuredSalaryBreakdown(payroll);
  const earnings = getPayrollEarningsBreakdown(payroll);
  const deductions = getPayrollDeductionsBreakdown(payroll);
  const earningsRows: PayslipLineRow[] = salaryBreakdown
    ? [
        { label: "Basic Salary", amount: salaryBreakdown.baseSalary },
        { label: "Incentive", amount: salaryBreakdown.incentive },
        { label: "Bonus", amount: salaryBreakdown.bonus },
        { label: "Custom Allowance", amount: salaryBreakdown.customAllowance },
        { label: "HRA", amount: salaryBreakdown.hra },
        { label: "Study Allowance", amount: salaryBreakdown.studyAllowance },
        { label: "Overtime", amount: salaryBreakdown.overtimePay },
      ].filter((row) => row.amount > 0)
    : Array.isArray(payroll.earnings)
      ? payroll.earnings
          .map((row) => ({ label: row.label, amount: toAmount(row.amount) }))
          .filter((row) => row.amount > 0)
      : [
          { label: "Basic Salary", amount: earnings.basicSalary },
          { label: "Study allowance", amount: earnings.studyAllowance },
          { label: "Performance Bonus", amount: earnings.bonus },
          { label: "House Rent Allowance", amount: earnings.hra },
        ].filter((row) => row.amount > 0);
  const deductionRows: PayslipLineRow[] = salaryBreakdown
    ? [
        { label: "LOP", amount: Math.max(0, -salaryBreakdown.attendanceAdjustment) },
        { label: "Other Deduction", amount: salaryBreakdown.deduction },
        { label: "Advance Deduction", amount: salaryBreakdown.advanceDeduction },
        { label: "PF", amount: salaryBreakdown.pf },
        { label: "TDS", amount: salaryBreakdown.tds },
        { label: "Professional Tax", amount: salaryBreakdown.professionalTax },
        { label: "Health Insurance", amount: salaryBreakdown.insurance },
      ].filter((row) => row.amount > 0)
    : Array.isArray(payroll.deductionItems)
      ? payroll.deductionItems
          .map((row) => ({ label: row.label, amount: toAmount(row.amount) }))
          .filter((row) => row.amount > 0)
      : [
          { label: "LOP", amount: deductions.lop },
          { label: "Professional Tax", amount: deductions.professionalTax },
          { label: "PF", amount: deductions.pf },
          { label: "Health Insurance", amount: deductions.insurance },
        ].filter((row) => row.amount > 0);

  while (deductionRows.length < earningsRows.length) {
    deductionRows.push({ label: "-", amount: 0 });
  }
  while (earningsRows.length < deductionRows.length) {
    earningsRows.push({ label: "-", amount: 0 });
  }

  const fallbackTotalEarnings = earningsRows.reduce((sum, row) => sum + row.amount, 0);
  const fallbackTotalDeductions = deductionRows.reduce((sum, row) => sum + row.amount, 0);
  const totalEarnings = salaryBreakdown?.grossSalary ?? fallbackTotalEarnings;
  const totalDeductions = salaryBreakdown?.totalDeductions ?? fallbackTotalDeductions;
  const computedNetPay = Math.max(0, totalEarnings - totalDeductions);
  const employeeId = input.employee.employeeId || payroll.employeeId || payroll.uid;
  const netPay = toAmount(salaryBreakdown?.netPay ?? payroll.netPay ?? payroll.netSalary ?? computedNetPay);
  const hasNetPayOverride =
    salaryBreakdown?.netPayOverride != null && salaryBreakdown.netPayOverride !== computedNetPay;
  const attendanceRows: PayslipDetailRow[] = [
    { label: "Working Days Basis", value: formatWholeNumber(payroll.totalWorkingDays ?? 30) },
    { label: "Present Days", value: formatWholeNumber(payroll.daysPresent) },
    { label: "Payable Days", value: formatWholeNumber(payroll.payableDays ?? payroll.daysPresent) },
    { label: "LOP Days", value: formatWholeNumber(payroll.daysAbsent) },
    { label: "Approved Leave", value: formatWholeNumber(payroll.leaveApprovedDays ?? 0) },
    { label: "Late Marks", value: formatWholeNumber(payroll.lateCount ?? payroll.lates) },
    { label: "Sessions Logged", value: formatWholeNumber(payroll.totalSessions ?? 0) },
    { label: "Worked Hours", value: formatDurationMinutes(payroll.totalWorkedMinutes ?? 0) },
    {
      label: "Half Days",
      value: formatWholeNumber(
        (payroll as Payroll & { attendanceSummary?: { halfDays?: number } }).attendanceSummary?.halfDays ?? 0,
      ),
    },
    {
      label: "Overtime",
      value: formatWholeNumber(
        (payroll as Payroll & { attendanceSummary?: { overtimeHours?: number } }).attendanceSummary?.overtimeHours ?? 0,
      ),
    },
  ];

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
    attendanceRows,
    earningsRows,
    deductionRows,
    totalEarnings,
    totalDeductions,
    computedNetPay,
    netPay,
    hasNetPayOverride,
    netPayFormula: hasNetPayOverride
      ? `Computed net pay: (${formatInrNumber(totalEarnings)} INR - ${formatInrNumber(totalDeductions)} INR) = ${formatInrNumber(computedNetPay)} INR | Final net pay override: ${formatInrNumber(netPay)} INR`
      : `(${formatInrNumber(totalEarnings)} INR - ${formatInrNumber(totalDeductions)} INR) = ${formatInrNumber(netPay)} INR`,
    netPaySummaryLine: hasNetPayOverride
      ? `Final Net Pay: ${formatInrNumber(netPay)} INR (manual override applied; computed net pay was ${formatInrNumber(computedNetPay)} INR)`
      : `Total Net Pay: (Total Earnings - Total Deductions) = (${formatInrNumber(totalEarnings)} INR - ${formatInrNumber(totalDeductions)} INR) = ${formatInrNumber(netPay)} INR`,
    filename: `payslip_${employeeId}_${payroll.month}.pdf`,
    month: payroll.month,
    monthLabel: formatMonthLabel(payroll.month),
    statusLabel: String(payroll.status ?? "GENERATED").replace(/_/g, " "),
    signatureLabel: "Authorised HR Signatory",
  };
}
