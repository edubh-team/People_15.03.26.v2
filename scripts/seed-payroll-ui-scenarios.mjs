import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { admin, getAdminApp, getAdminDb } from "./lib/firebase-admin.mjs";

const TEST_MONTH = "2026-03";
const PASSWORD = "Payroll@2026";
const COMPANY = "Edubh / PayLink4U";
const HR_ACCOUNT = {
  uid: "qa-payroll-hr-202603",
  employeeId: "EPY-QA-HR01",
  name: "QA Payroll HR",
  email: "qa.payroll.hr.202603@example.com",
  designation: "HR Manager",
  department: "Human Resources",
  salary: 65000,
  status: "active",
  role: "HR",
  orgRole: "HR",
};

const scenarios = [
  {
    uid: "qa-payroll-generated-202603",
    employeeId: "EPY-QA-3101",
    name: "QA Payroll Generated",
    email: "qa.payroll.generated.202603@example.com",
    designation: "Software Engineer",
    department: "Technology",
    salary: 60000,
    status: "active",
    payrollStatus: "GENERATED",
    attendance: {
      presentDays: 24,
      lateDays: 2,
      absentDays: 2,
      leaveStart: "2026-03-29",
      leaveEnd: "2026-03-30",
      leavesApproved: 2,
    },
  },
  {
    uid: "qa-payroll-paid-202603",
    employeeId: "EPY-QA-3102",
    name: "QA Payroll Paid",
    email: "qa.payroll.paid.202603@example.com",
    designation: "HR Executive",
    department: "Human Resources",
    salary: 55000,
    status: "active",
    payrollStatus: "PAID",
    attendance: {
      presentDays: 25,
      lateDays: 1,
      absentDays: 1,
      leaveStart: "2026-03-30",
      leaveEnd: "2026-03-30",
      leavesApproved: 1,
    },
  },
  {
    uid: "qa-payroll-pending-202603",
    employeeId: "EPY-QA-3103",
    name: "QA Payroll Pending",
    email: "qa.payroll.pending.202603@example.com",
    designation: "Sales Associate",
    department: "Sales",
    salary: 50000,
    status: "active",
    payrollStatus: null,
    attendance: {
      presentDays: 22,
      lateDays: 3,
      absentDays: 3,
      leaveStart: "2026-03-29",
      leaveEnd: "2026-03-30",
      leavesApproved: 2,
    },
  },
  {
    uid: "qa-payroll-zero-202603",
    employeeId: "EPY-QA-3104",
    name: "QA Payroll Zero Salary",
    email: "qa.payroll.zero.202603@example.com",
    designation: "Support Executive",
    department: "Operations",
    salary: 0,
    status: "active",
    payrollStatus: null,
    attendance: {
      presentDays: 21,
      lateDays: 1,
      absentDays: 4,
      leaveStart: "2026-03-29",
      leaveEnd: "2026-03-30",
      leavesApproved: 2,
    },
  },
  {
    uid: "qa-payroll-missing-attendance-202603",
    employeeId: "EPY-QA-3105",
    name: "QA Payroll Missing Attendance",
    email: "qa.payroll.missing.attendance.202603@example.com",
    designation: "QA Analyst",
    department: "Quality",
    salary: 45000,
    status: "active",
    payrollStatus: null,
    attendance: null,
  },
];

function monthParts(month) {
  const [yyyy, mm] = month.split("-");
  return { yyyy, mm };
}

function dateRange(startDay, count) {
  return Array.from({ length: count }, (_, index) => {
    const day = String(startDay + index).padStart(2, "0");
    return `${TEST_MONTH}-${day}`;
  });
}

function buildAttendanceRows(config) {
  if (!config) return [];

  const present = dateRange(1, config.presentDays).map((dateKey) => ({
    dateKey,
    status: "checked_out",
    dayStatus: "present",
  }));
  const late = dateRange(1 + config.presentDays, config.lateDays).map((dateKey) => ({
    dateKey,
    status: "checked_out",
    dayStatus: "late",
  }));
  const absent = dateRange(1 + config.presentDays + config.lateDays, config.absentDays).map((dateKey) => ({
    dateKey,
    status: "absent",
    dayStatus: "absent",
  }));

  return [...present, ...late, ...absent];
}

function buildPayrollAmounts(salary, daysAbsent) {
  const deduction = Math.round((Number(salary || 0) / 30) * daysAbsent);
  return {
    basicSalary: Number(salary || 0),
    deductions: deduction,
    netPay: Math.max(0, Math.round(Number(salary || 0) - deduction)),
  };
}

async function ensureAuthUser(adminAuth, scenario) {
  try {
    await adminAuth.getUser(scenario.uid);
    await adminAuth.updateUser(scenario.uid, {
      email: scenario.email,
      password: PASSWORD,
      displayName: scenario.name,
      emailVerified: true,
      disabled: false,
    });
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      await adminAuth.createUser({
        uid: scenario.uid,
        email: scenario.email,
        password: PASSWORD,
        displayName: scenario.name,
        emailVerified: true,
        disabled: false,
      });
      return;
    }
    throw error;
  }
}

async function replaceAttendanceMonth(adminDb, scenario) {
  const { yyyy, mm } = monthParts(TEST_MONTH);
  const daysCollection = adminDb
    .collection("users")
    .doc(scenario.uid)
    .collection("attendance")
    .doc(yyyy)
    .collection("months")
    .doc(mm)
    .collection("days");

  const existing = await daysCollection.get();
  if (!existing.empty) {
    const batch = adminDb.batch();
    existing.docs.forEach((row) => batch.delete(row.ref));
    await batch.commit();
  }

  if (!scenario.attendance) return;

  const now = new Date();
  const rows = buildAttendanceRows(scenario.attendance);
  if (rows.length === 0) return;

  const batch = adminDb.batch();
  rows.forEach((row) => {
    const ref = daysCollection.doc(row.dateKey);
    batch.set(ref, {
      uid: scenario.uid,
      userId: scenario.uid,
      dateKey: row.dateKey,
      status: row.status,
      dayStatus: row.dayStatus,
      checkedInAt: now,
      checkedOutAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
  await batch.commit();
}

async function replaceLeaveRequests(adminDb, scenario) {
  const existing = await adminDb
    .collection("leaveRequests")
    .where("uid", "==", scenario.uid)
    .get();

  if (!existing.empty) {
    const batch = adminDb.batch();
    existing.docs.forEach((row) => batch.delete(row.ref));
    await batch.commit();
  }

  if (!scenario.attendance?.leavesApproved) return;

  const now = new Date();
  const leaveId = `qa-leave-${scenario.uid}-${TEST_MONTH}`;
  await adminDb.collection("leaveRequests").doc(leaveId).set({
    uid: scenario.uid,
    startDateKey: scenario.attendance.leaveStart,
    endDateKey: scenario.attendance.leaveEnd,
    type: "casual",
    status: "approved",
    includeSaturdayAsLeave: false,
    chargeableDays: scenario.attendance.leavesApproved,
    assignedHR: "qa-hr",
    reason: "QA payroll scenario leave seed",
    createdAt: now,
    updatedAt: now,
  });
}

async function replacePayrollDoc(adminDb, scenario) {
  const payrollId = `${scenario.uid}_${TEST_MONTH}`;
  const payrollRef = adminDb.collection("payroll").doc(payrollId);

  if (!scenario.payrollStatus) {
    await payrollRef.delete().catch(() => {});
    return;
  }

  const daysAbsent = scenario.attendance?.absentDays ?? 0;
  const daysPresent = (scenario.attendance?.presentDays ?? 0) + (scenario.attendance?.lateDays ?? 0);
  const lateCount = scenario.attendance?.lateDays ?? 0;
  const leavesApproved = scenario.attendance?.leavesApproved ?? 0;
  const amounts = buildPayrollAmounts(scenario.salary, daysAbsent);
  const now = new Date();

  await payrollRef.set({
    id: payrollId,
    uid: scenario.uid,
    employeeId: scenario.employeeId,
    month: TEST_MONTH,
    basicSalary: amounts.basicSalary,
    baseSalary: amounts.basicSalary,
    grossSalary: amounts.basicSalary,
    daysPresent,
    daysAbsent,
    lates: lateCount,
    lateCount,
    incentives: 0,
    bonus: 0,
    bonuses: 0,
    deductions: amounts.deductions,
    leaveApprovedDays: leavesApproved,
    netPay: amounts.netPay,
    netSalary: amounts.netPay,
    status: scenario.payrollStatus,
    generatedAt: now,
    paidAt: scenario.payrollStatus === "PAID" ? now : null,
    userDisplayName: scenario.name,
    userEmail: scenario.email,
    designation: scenario.designation,
    department: scenario.department,
    joiningDate: "2025-04-01",
    paymentPeriodStart: `${TEST_MONTH}-01`,
    paymentPeriodEnd: `${TEST_MONTH}-30`,
    paymentDate: "2026-03-31",
    earnings: [
      { label: "Basic Salary", amount: amounts.basicSalary },
    ],
    deductionItems: [
      { label: "Absent deduction", amount: amounts.deductions },
    ],
  });
}

async function seedScenario(adminDb, adminAuth, scenario) {
  const now = new Date();

  await ensureAuthUser(adminAuth, scenario);
  await adminDb.collection("users").doc(scenario.uid).set(
    {
      uid: scenario.uid,
      employeeId: scenario.employeeId,
      email: scenario.email,
      displayName: scenario.name,
      designation: scenario.designation,
      department: scenario.department,
      joiningDate: "2025-04-01",
      role: scenario.role ?? "employee",
      orgRole: scenario.orgRole ?? "EMPLOYEE",
      status: scenario.status,
      isActive: true,
      teamLeadId: null,
      salary: scenario.salary,
      salaryStructure: {
        base: scenario.salary,
        bonusRate: 0,
        deductionRate: 0,
      },
      settings: { workspace: "CRM" },
      onboardingCompleted: true,
      payrollStatus: scenario.payrollStatus ? "active" : "pending",
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  await replaceAttendanceMonth(adminDb, scenario);
  await replaceLeaveRequests(adminDb, scenario);
  await replacePayrollDoc(adminDb, scenario);
}

function buildDocument() {
  const lines = [
    "# Payroll UI Test Document",
    "",
    `Company: ${COMPANY}`,
    `Test Month: ${TEST_MONTH}`,
    `Generated On: ${new Date().toISOString()}`,
    "",
    "## Seed Command",
    "",
    "```bash",
    "npm run seed:payroll-ui",
    "```",
    "",
    "## HR UI Route",
    "",
    "- Open `/hr/payroll`",
    `- Set month filter to \`${TEST_MONTH}\``,
    "- Find rows using the employee IDs below",
    "",
    "## Shared Password",
    "",
    `- Password for all QA employee accounts: \`${PASSWORD}\``,
    `- HR QA login: \`${HR_ACCOUNT.email}\``,
    "",
    "## Scenario Matrix",
    "",
    "| Scenario | Employee Name | Employee ID | Expected Table Status | Expected UI Action |",
    "| --- | --- | --- | --- | --- |",
    "| Pre-generated payroll | QA Payroll Generated | EPY-QA-3101 | GENERATED | Download button visible |",
    "| Paid payroll | QA Payroll Paid | EPY-QA-3102 | PAID | Download button visible |",
    "| Pending valid payroll | QA Payroll Pending | EPY-QA-3103 | NOT GENERATED | Generate button visible |",
    "| Zero salary | QA Payroll Zero Salary | EPY-QA-3104 | ZERO SALARY | Generate disabled |",
    "| Missing attendance | QA Payroll Missing Attendance | EPY-QA-3105 | MISSING ATTENDANCE | Generate allowed but should fail with toast |",
    "",
    "## Employee Login Accounts",
    "",
    "| Employee Name | Email | Main Purpose |",
    "| --- | --- | --- |",
    "| QA Payroll Generated | qa.payroll.generated.202603@example.com | Profile/Employee payslip download test |",
    "| QA Payroll Paid | qa.payroll.paid.202603@example.com | Paid payslip download test |",
    "| QA Payroll Pending | qa.payroll.pending.202603@example.com | Empty state before generate, then payslip after generate |",
    "| QA Payroll Zero Salary | qa.payroll.zero.202603@example.com | Verify no payslip and zero-salary payroll block |",
    "| QA Payroll Missing Attendance | qa.payroll.missing.attendance.202603@example.com | Verify no payslip and failed generation state |",
    "",
    "## HR Login Account",
    "",
    "| Name | Email | Purpose |",
    "| --- | --- | --- |",
    `| ${HR_ACCOUNT.name} | ${HR_ACCOUNT.email} | Open \`/hr/payroll\` and test all HR payroll actions |`,
    "",
    "## UI Test Cases",
    "",
    "### 1. Payroll Dashboard",
    "",
    `1. Login as HR/Admin and open \`/hr/payroll\`.`,
    `2. Select month \`${TEST_MONTH}\`.`,
    "3. Verify the cards show live counts for Total Employees, Total Payout, and Payroll Records.",
    "4. Verify the header shows `Live` and the pending count badge.",
    "",
    "### 2. Single Generate",
    "",
    "1. Locate `QA Payroll Pending`.",
    "2. Click `Generate`.",
    "3. Expected: success toast appears.",
    "4. Expected: row status changes to `GENERATED` after refresh.",
    "5. Expected: `Download` button replaces `Generate`.",
    "",
    "### 3. Duplicate Prevention",
    "",
    "1. Re-run `Generate All Pending` after the pending employee is generated.",
    "2. Expected: bulk toast summary shows `already done` count for existing payroll rows.",
    "3. Expected: no duplicate payroll documents are created.",
    "",
    "### 4. Bulk Generate",
    "",
    "1. Click `Generate All Pending` in the payroll header.",
    "2. Expected toast summary for this seed set:",
    "   - generated: 1",
    "   - already done: 2",
    "   - missing attendance: 1",
    "   - zero salary: 1",
    "3. Expected: `QA Payroll Pending` becomes `GENERATED`.",
    "4. Expected: `QA Payroll Zero Salary` stays `ZERO SALARY`.",
    "5. Expected: `QA Payroll Missing Attendance` stays `MISSING ATTENDANCE`.",
    "",
    "### 5. Generated Payslip PDF",
    "",
    "1. Click download for `QA Payroll Generated` or `QA Payroll Paid`.",
    "2. Expected filename format: `payslip_2026-03_<employeeId>.pdf`.",
    "3. Expected PDF sections:",
    "   - Payslip header",
    "   - Company name",
    "   - Employee Name, Employee ID, Designation, Department",
    "   - Earnings",
    "   - Deductions",
    "   - Attendance Summary",
    "   - Total Net Pay",
    "",
    "### 6. Missing Attendance Error",
    "",
    "1. Locate `QA Payroll Missing Attendance`.",
    "2. Click `Generate`.",
    "3. Expected: error toast saying attendance is missing for the selected month.",
    "4. Expected: no payroll doc gets created.",
    "",
    "### 7. Zero Salary Block",
    "",
    "1. Locate `QA Payroll Zero Salary`.",
    "2. Expected: status badge `ZERO SALARY`.",
    "3. Expected: row issue says salary is zero or missing.",
    "4. Expected: generate action is disabled.",
    "",
    "### 8. Employee Self-Service",
    "",
    "1. Login as `qa.payroll.generated.202603@example.com`.",
    "2. Open `/profile` and `/employee`.",
    "3. Expected: payslip panel is visible in both places.",
    "4. Expected: March 2026 payslip can be downloaded.",
    "",
    "### 9. Employee Empty State Then Success",
    "",
    "1. Login as `qa.payroll.pending.202603@example.com` before generation.",
    "2. Open `/profile` or `/employee`.",
    "3. Expected: payslips panel shows empty state.",
    "4. Generate payroll from HR UI.",
    "5. Refresh employee pages.",
    "6. Expected: March 2026 payslip now appears and downloads correctly.",
    "",
    "## Firestore Records Created",
    "",
    "- `users/{uid}` for 5 QA employees",
    "- `users/{uid}/attendance/2026/months/03/days/*` for all except missing-attendance scenario",
    "- `leaveRequests/qa-leave-{uid}-2026-03` where leave is seeded",
    "- `payroll/{uid}_2026-03` for generated and paid scenarios",
    "",
    "## Notes",
    "",
    "- Use employee IDs to find the rows faster if the payroll table contains many real employees.",
    "- If you re-run the seed command, it resets these QA rows to the same baseline state.",
  ];

  return lines.join("\n");
}

async function main() {
  const app = getAdminApp();
  const adminDb = getAdminDb();
  const adminAuth = admin.auth(app);

  await seedScenario(adminDb, adminAuth, {
    ...HR_ACCOUNT,
    payrollStatus: null,
    attendance: null,
  });

  for (const scenario of scenarios) {
    await seedScenario(adminDb, adminAuth, scenario);
  }

  const docPath = resolve("docs", "payroll-ui-test-document.md");
  mkdirSync(resolve("docs"), { recursive: true });
  writeFileSync(docPath, buildDocument(), "utf8");

  console.log(JSON.stringify({
    ok: true,
    month: TEST_MONTH,
    password: PASSWORD,
    docPath,
    hrLogin: HR_ACCOUNT.email,
    scenarios: scenarios.map((scenario) => ({
      employeeId: scenario.employeeId,
      email: scenario.email,
      payrollStatus: scenario.payrollStatus ?? "NONE",
      attendanceSeeded: Boolean(scenario.attendance),
      salary: scenario.salary,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
