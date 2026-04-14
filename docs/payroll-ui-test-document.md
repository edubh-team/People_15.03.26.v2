# Payroll UI Test Document

Company: Edubh / PayLink4U
Test Month: 2026-03
Generated On: 2026-03-31T08:20:40.234Z

## Seed Command

```bash
npm run seed:payroll-ui
```

## HR UI Route

- Open `/hr/payroll`
- Set month filter to `2026-03`
- Find rows using the employee IDs below

## Shared Password

- Password for all QA employee accounts: `Payroll@2026`
- HR QA login: `qa.payroll.hr.202603@example.com`

## Scenario Matrix

| Scenario | Employee Name | Employee ID | Expected Table Status | Expected UI Action |
| --- | --- | --- | --- | --- |
| Pre-generated payroll | QA Payroll Generated | 9A-3101 | GENERATED | Download button visible |
| Paid payroll | QA Payroll Paid | EPY-QA-3102 | PAID | Download button visible |
| Pending valid payroll | QA Payroll Pending | EPY-QA-3103 | NOT GENERATED | Generate button visible |
| Zero salary | QA Payroll Zero Salary | EPY-QA-3104 | ZERO SALARY | Generate disabled |
| Missing attendance | QA Payroll Missing Attendance | EPY-QA-3105 | MISSING ATTENDANCE | Generate allowed but should fail with toast |

## Employee Login Accounts

| Employee Name | Email | Main Purpose |
| --- | --- | --- |
| QA Payroll Generated | qa.payroll.generated.202603@example.com | Profile/Employee payslip download test |
| QA Payroll Paid | qa.payroll.paid.202603@example.com | Paid payslip download test |
| QA Payroll Pending | qa.payroll.pending.202603@example.com | Empty state before generate, then payslip after generate |
| QA Payroll Zero Salary | qa.payroll.zero.202603@example.com | Verify no payslip and zero-salary payroll block |
| QA Payroll Missing Attendance | qa.payroll.missing.attendance.202603@example.com | Verify no payslip and failed generation state |

## HR Login Account

| Name | Email | Purpose |
| --- | --- | --- |
| QA Payroll HR | qa.payroll.hr.202603@example.com | Open `/hr/payroll` and test all HR payroll actions |

## UI Test Cases

### 1. Payroll Dashboard

1. Login as HR/Admin and open `/hr/payroll`.
2. Select month `2026-03`.
3. Verify the cards show live counts for Total Employees, Total Payout, and Payroll Records.
4. Verify the header shows `Live` and the pending count badge.

### 2. Single Generate

1. Locate `QA Payroll Pending`.
2. Click `Generate`.
3. Expected: success toast appears.
4. Expected: row status changes to `GENERATED` after refresh.
5. Expected: `Download` button replaces `Generate`.

### 3. Duplicate Prevention

1. Re-run `Generate All Pending` after the pending employee is generated.
2. Expected: bulk toast summary shows `already done` count for existing payroll rows.
3. Expected: no duplicate payroll documents are created.

### 4. Bulk Generate

1. Click `Generate All Pending` in the payroll header.
2. Expected toast summary for this seed set:
   - generated: 1
   - already done: 2
   - missing attendance: 1
   - zero salary: 1
3. Expected: `QA Payroll Pending` becomes `GENERATED`.
4. Expected: `QA Payroll Zero Salary` stays `ZERO SALARY`.
5. Expected: `QA Payroll Missing Attendance` stays `MISSING ATTENDANCE`.

### 5. Generated Payslip PDF

1. Click download for `QA Payroll Generated` or `QA Payroll Paid`.
2. Expected filename format: `payslip_2026-03_<employeeId>.pdf`.
3. Expected PDF sections:
   - Payslip header
   - Company name
   - Employee Name, Employee ID, Designation, Department
   - Earnings
   - Deductions
   - Attendance Summary
   - Total Net Pay

### 6. Missing Attendance Error

1. Locate `QA Payroll Missing Attendance`.
2. Click `Generate`.
3. Expected: error toast saying attendance is missing for the selected month.
4. Expected: no payroll doc gets created.

### 7. Zero Salary Block

1. Locate `QA Payroll Zero Salary`.
2. Expected: status badge `ZERO SALARY`.
3. Expected: row issue says salary is zero or missing.
4. Expected: generate action is disabled.

### 8. Employee Self-Service

1. Login as `qa.payroll.generated.202603@example.com`.
2. Open `/profile` and `/employee`.
3. Expected: payslip panel is visible in both places.
4. Expected: March 2026 payslip can be downloaded.

### 9. Employee Empty State Then Success

1. Login as `qa.payroll.pending.202603@example.com` before generation.
2. Open `/profile` or `/employee`.
3. Expected: payslips panel shows empty state.
4. Generate payroll from HR UI.
5. Refresh employee pages.
6. Expected: March 2026 payslip now appears and downloads correctly.

## Firestore Records Created

- `users/{uid}` for 5 QA employees
- `users/{uid}/attendance/2026/months/03/days/*` for all except missing-attendance scenario
- `leaveRequests/qa-leave-{uid}-2026-03` where leave is seeded
- `payroll/{uid}_2026-03` for generated and paid scenarios

## Notes

- Use employee IDs to find the rows faster if the payroll table contains many real employees.
- If you re-run the seed command, it resets these QA rows to the same baseline state.