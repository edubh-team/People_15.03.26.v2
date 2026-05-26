import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase-admin.mjs";

const DEFAULT_HOST = "http://127.0.0.1:3000";
const DEFAULT_MONTH = "2026-03";
const QA_PASSWORD = "Payroll@2026";

const QA_FIXTURES = {
  hr: {
    label: "hr",
    uid: "qa-payroll-hr-202603",
    employeeId: "EPY-QA-HR01",
    email: "qa.payroll.hr.202603@example.com",
  },
  generated: {
    label: "generated",
    uid: "qa-payroll-generated-202603",
    employeeId: "EPY-QA-3101",
    email: "qa.payroll.generated.202603@example.com",
  },
  pending: {
    label: "pending",
    uid: "qa-payroll-pending-202603",
    employeeId: "EPY-QA-3103",
    email: "qa.payroll.pending.202603@example.com",
  },
  zero: {
    label: "zero",
    uid: "qa-payroll-zero-202603",
    employeeId: "EPY-QA-3104",
    email: "qa.payroll.zero.202603@example.com",
  },
  missingAttendance: {
    label: "missingAttendance",
    uid: "qa-payroll-missing-attendance-202603",
    employeeId: "EPY-QA-3105",
    email: "qa.payroll.missing.attendance.202603@example.com",
  },
};

function readArg(name, fallback = null) {
  const entry = process.argv.find((value) => value === name || value.startsWith(`${name}=`));
  if (!entry) return fallback;
  if (entry === name) {
    const index = process.argv.indexOf(entry);
    return process.argv[index + 1] ?? fallback;
  }
  return entry.slice(name.length + 1);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function payrollRecordId(uid, month) {
  return `${uid}_${month}`;
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function signIn(email, password) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  assertCondition(apiKey, "Missing NEXT_PUBLIC_FIREBASE_API_KEY in environment.");

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${email}: ${payload.error?.message ?? "Sign-in failed."}`);
  }
  return payload.idToken;
}

async function apiRequest(input) {
  const response = await fetch(`${input.host}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.token}`,
      ...(input.body ? { "Content-Type": "application/json" } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf")) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      pdfBytes: buffer.length,
      body: null,
    };
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    contentType,
    pdfBytes: 0,
    body: parsed,
  };
}

async function printStatus(month) {
  const db = getAdminDb();
  const fixtureEntries = Object.values(QA_FIXTURES);

  for (const fixture of fixtureEntries) {
    const [userSnap, legacyPayrollSnap, payrollRecordSnap] = await Promise.all([
      db.collection("users").doc(fixture.uid).get(),
      db.collection("payroll").doc(payrollRecordId(fixture.uid, month)).get(),
      db.collection("payroll_records").doc(payrollRecordId(fixture.uid, month)).get(),
    ]);

    console.log(
      JSON.stringify(
        {
          label: fixture.label,
          uid: fixture.uid,
          userExists: userSnap.exists,
          employeeId: userSnap.exists ? userSnap.data()?.employeeId ?? null : null,
          legacyPayrollStatus: legacyPayrollSnap.exists ? legacyPayrollSnap.data()?.status ?? null : null,
          payrollRecordStatus: payrollRecordSnap.exists ? payrollRecordSnap.data()?.status ?? null : null,
          visibleToEmployee: payrollRecordSnap.exists
            ? Boolean(payrollRecordSnap.data()?.isVisibleToEmployee)
            : null,
          notificationId: payrollRecordSnap.exists ? payrollRecordSnap.data()?.notificationId ?? null : null,
        },
        null,
        2,
      ),
    );
  }
}

async function resetGeneratedFixture(month) {
  const db = getAdminDb();
  const fixture = QA_FIXTURES.generated;
  const recordId = payrollRecordId(fixture.uid, month);
  const payrollRecordRef = db.collection("payroll_records").doc(recordId);
  const legacyPayrollRef = db.collection("payroll").doc(recordId);
  const employeePayslipRef = db.collection("employee_payslips").doc(recordId);
  const payrollRecordSnap = await payrollRecordRef.get();

  assertCondition(payrollRecordSnap.exists, `Missing payroll_records/${recordId}`);

  const payrollRecord = payrollRecordSnap.data() ?? {};
  const notificationId = payrollRecord.notificationId ?? null;

  const versionsSnap = await db
    .collection("payroll_versions")
    .where("payrollRecordId", "==", recordId)
    .get();

  const employeeNotificationsSnap = await db
    .collection("employee_notifications")
    .where("payrollRecordId", "==", recordId)
    .get();

  const notificationsSnap = await db
    .collection("notifications")
    .where("payrollRecordId", "==", recordId)
    .get();

  const batch = db.batch();

  batch.set(
    payrollRecordRef,
    {
      status: "GENERATED",
      isVisibleToEmployee: false,
      notificationId: null,
      sentAt: FieldValue.delete(),
      sentBy: FieldValue.delete(),
      approvedAt: FieldValue.delete(),
      approvedBy: FieldValue.delete(),
      downloadedAt: FieldValue.delete(),
      downloadHistory: [],
      downloadCount: 0,
      version: 1,
      updatedAt: new Date(),
    },
    { merge: true },
  );

  batch.set(
    legacyPayrollRef,
    {
      status: "GENERATED",
      sentAt: FieldValue.delete(),
      approvedAt: FieldValue.delete(),
      downloadedAt: FieldValue.delete(),
      version: 1,
      updatedAt: new Date(),
    },
    { merge: true },
  );

  versionsSnap.docs.forEach((row) => batch.delete(row.ref));
  employeeNotificationsSnap.docs.forEach((row) => batch.delete(row.ref));
  notificationsSnap.docs.forEach((row) => batch.delete(row.ref));
  batch.delete(employeePayslipRef);

  if (notificationId) {
    batch.delete(db.collection("employee_notifications").doc(notificationId));
    batch.delete(db.collection("notifications").doc(notificationId));
  }

  await batch.commit();
  console.log(`Reset fixture ${fixture.employeeId} for ${month} back to GENERATED.`);
}

async function runSmoke(month, host, options) {
  const hrToken = await signIn(QA_FIXTURES.hr.email, QA_PASSWORD);
  const employeeToken = await signIn(QA_FIXTURES.generated.email, QA_PASSWORD);

  if (options.expectPreSend) {
    const preSendMe = await apiRequest({
      host,
      token: employeeToken,
      path: "/api/payroll/me",
    });
    assertCondition(preSendMe.status === 200, "Expected employee /api/payroll/me before send to return 200.");
    assertCondition(
      Array.isArray(preSendMe.body?.items) && preSendMe.body.items.length === 0,
      "Expected employee /api/payroll/me before send to be empty.",
    );

    const preSendDetail = await apiRequest({
      host,
      token: employeeToken,
      path: `/api/payroll/${QA_FIXTURES.generated.employeeId}/${month}`,
    });
    assertCondition(preSendDetail.status === 403, "Expected employee detail before send to return 403.");
  }

  const duplicateGenerate = await apiRequest({
    host,
    token: hrToken,
    method: "POST",
    path: "/api/payroll/generate",
    body: {
      employeeId: QA_FIXTURES.generated.employeeId,
      month,
    },
  });
  assertCondition(
    duplicateGenerate.status === 409,
    `Expected duplicate generate to return 409, received ${duplicateGenerate.status}.`,
  );

  const zeroSalary = await apiRequest({
    host,
    token: hrToken,
    method: "POST",
    path: "/api/payroll/generate",
    body: {
      employeeId: QA_FIXTURES.zero.employeeId,
      month,
    },
  });
  assertCondition(
    zeroSalary.status === 422,
    `Expected zero-salary generate to return 422, received ${zeroSalary.status}.`,
  );

  const missingAttendance = await apiRequest({
    host,
    token: hrToken,
    method: "POST",
    path: "/api/payroll/generate",
    body: {
      employeeId: QA_FIXTURES.missingAttendance.employeeId,
      month,
    },
  });
  assertCondition(
    missingAttendance.status === 422,
    `Expected missing-attendance generate to return 422, received ${missingAttendance.status}.`,
  );

  const approve = await apiRequest({
    host,
    token: hrToken,
    method: "POST",
    path: `/api/payroll/${QA_FIXTURES.generated.employeeId}/${month}/approve`,
  });
  assertCondition(approve.status === 200, `Expected approve to return 200, received ${approve.status}.`);
  assertCondition(
    approve.body?.payroll?.status === "APPROVED",
    `Expected approve status to be APPROVED, received ${approve.body?.payroll?.status}.`,
  );

  const send = await apiRequest({
    host,
    token: hrToken,
    method: "POST",
    path: `/api/payroll/${QA_FIXTURES.generated.employeeId}/${month}/send`,
  });
  assertCondition(send.status === 200, `Expected send to return 200, received ${send.status}.`);
  assertCondition(
    send.body?.payroll?.status === "SENT",
    `Expected send status to be SENT, received ${send.body?.payroll?.status}.`,
  );

  const employeeMe = await apiRequest({
    host,
    token: employeeToken,
    path: "/api/payroll/me",
  });
  assertCondition(employeeMe.status === 200, `Expected employee /api/payroll/me to return 200, received ${employeeMe.status}.`);
  assertCondition(
    Array.isArray(employeeMe.body?.items) &&
      employeeMe.body.items.some((row) => row.id === payrollRecordId(QA_FIXTURES.generated.uid, month)),
    "Expected employee /api/payroll/me to include the sent payroll record.",
  );

  const employeePayslips = await apiRequest({
    host,
    token: employeeToken,
    path: "/api/employee/payslips",
  });
  assertCondition(
    employeePayslips.status === 200,
    `Expected employee /api/employee/payslips to return 200, received ${employeePayslips.status}.`,
  );
  assertCondition(
    Array.isArray(employeePayslips.body?.items) &&
      employeePayslips.body.items.some((row) => row.id === payrollRecordId(QA_FIXTURES.generated.uid, month)),
    "Expected employee /api/employee/payslips to include the sent payslip.",
  );

  const employeePayslipId =
    employeePayslips.body?.items?.find((row) => row.id === payrollRecordId(QA_FIXTURES.generated.uid, month))?.id ??
    payrollRecordId(QA_FIXTURES.generated.uid, month);

  const employeeDetail = await apiRequest({
    host,
    token: employeeToken,
    path: `/api/payroll/${QA_FIXTURES.generated.employeeId}/${month}`,
  });
  assertCondition(employeeDetail.status === 200, `Expected employee detail to return 200, received ${employeeDetail.status}.`);
  assertCondition(
    employeeDetail.body?.payroll?.status === "SENT" ||
      employeeDetail.body?.payroll?.status === "DOWNLOADED",
    `Expected employee detail status to be SENT or DOWNLOADED, received ${employeeDetail.body?.payroll?.status}.`,
  );

  const employeePdf = await apiRequest({
    host,
    token: employeeToken,
    path: `/api/payroll/${QA_FIXTURES.generated.employeeId}/${month}/pdf`,
  });
  assertCondition(employeePdf.status === 200, `Expected employee pdf to return 200, received ${employeePdf.status}.`);
  assertCondition(employeePdf.pdfBytes > 0, "Expected employee PDF to contain bytes.");

  const employeePayslipDetail = await apiRequest({
    host,
    token: employeeToken,
    path: `/api/employee/payslips/${employeePayslipId}`,
  });
  assertCondition(
    employeePayslipDetail.status === 200,
    `Expected employee payslip detail to return 200, received ${employeePayslipDetail.status}.`,
  );

  const employeePayslipPdf = await apiRequest({
    host,
    token: employeeToken,
    path: `/api/employee/payslips/${employeePayslipId}/download`,
  });
  assertCondition(
    employeePayslipPdf.status === 200,
    `Expected employee payslip download to return 200, received ${employeePayslipPdf.status}.`,
  );
  assertCondition(employeePayslipPdf.pdfBytes > 0, "Expected employee payslip download PDF to contain bytes.");

  console.log(
    JSON.stringify(
      {
        month,
        host,
        checks: {
          duplicateGenerate: duplicateGenerate.status,
          zeroSalary: zeroSalary.status,
          missingAttendance: missingAttendance.status,
          approve: approve.body?.payroll?.status,
          send: send.body?.payroll?.status,
          employeeItems: employeeMe.body?.items?.length ?? 0,
          employeePayslipItems: employeePayslips.body?.items?.length ?? 0,
          employeePdfBytes: employeePdf.pdfBytes,
          employeePayslipPdfBytes: employeePayslipPdf.pdfBytes,
        },
      },
      null,
      2,
    ),
  );
}

async function main() {
  const command = process.argv[2] ?? "status";
  const month = readArg("--month", DEFAULT_MONTH);
  const host = readArg("--host", DEFAULT_HOST);

  if (command === "status") {
    await printStatus(month);
    return;
  }

  if (command === "reset-generated") {
    await resetGeneratedFixture(month);
    return;
  }

  if (command === "smoke") {
    if (hasFlag("--reset-first")) {
      await resetGeneratedFixture(month);
    }
    await runSmoke(month, host, {
      expectPreSend: hasFlag("--expect-pre-send"),
    });
    if (hasFlag("--reset-after")) {
      await resetGeneratedFixture(month);
    }
    return;
  }

  throw new Error(
    `Unknown command "${command}". Use one of: status, reset-generated, smoke.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
