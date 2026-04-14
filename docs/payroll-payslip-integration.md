# Payroll Payslip Integration

## What changed

The payroll module now uses a shared payslip presentation layer for:

- PDF generation
- HTML preview modal
- filename generation
- INR and date formatting

Core files:

- `src/lib/payroll/payslip.ts`
- `src/lib/server/payroll-pdf.ts`
- `src/components/payroll/PayslipPreviewCard.tsx`
- `src/components/payroll/PayslipPreviewModal.tsx`
- `src/components/hr/DownloadPayslipButton.tsx`

## Data model

`Payroll` now supports structured payslip fields:

```ts
earnings: {
  basicSalary: number;
  studyAllowance: number;
  bonus: number;
  hra: number;
}

deductionBreakdown: {
  lop: number;
  professionalTax: number;
  pf: number;
  insurance: number;
}
```

Legacy payroll rows are still supported. The helper layer normalizes older records automatically.

## Formatting helpers

Use these helpers from `src/lib/payroll/payslip.ts`:

- `formatInr(value)`
- `formatPayslipDate(value)`
- `formatPaymentPeriod(start, end, month)`
- `buildPayslipPreviewModel({ employee, payroll })`
- `normalizePayrollRecord(payroll)`

## Download API

PDF download route:

```txt
GET /api/payroll/:employeeId/:month/pdf
```

Optional query:

```txt
?payrollId=<document-id>
```

This makes download resilient for both canonical and legacy payroll document ids.

## Frontend integration

HR/Admin payroll table:

- Preview via `PayslipPreviewModal`
- Download via `DownloadPayslipButton`
- Edit via `EditPayrollModal` for direct earnings/deductions management

Employee payslips panel:

- Preview via `PayslipPreviewModal`
- Download via `DownloadPayslipButton`

## Replacing the logo

Current placeholder asset:

- `public/assets/edubh-payroll-logo.svg`

Replace it with the final brand logo using the same path to avoid code changes.

## Notes

- Role gating remains enforced by the payroll API routes.
- PDF filenames use `payslip_{employeeId}_{month}.pdf`.
- Preview and PDF are designed from the same normalized payslip data to reduce drift.
