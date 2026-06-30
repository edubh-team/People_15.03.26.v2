import { NextResponse } from "next/server";
import { sendPayrollToEmployee } from "@/lib/server/payroll-service";
import { requirePayrollRequestUser } from "@/lib/server/request-auth";
import type { SendPayslipRequest } from "@/lib/types/payroll";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const verified = await requirePayrollRequestUser(req);
  if (!verified.ok) return verified.response;

  try {
    const body = (await req.json()) as Partial<SendPayslipRequest>;
    const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
    const month = typeof body.month === "string" ? body.month.trim() : "";
    const payrollRecordId =
      typeof body.payrollRecordId === "string" ? body.payrollRecordId.trim() : undefined;

    const payload = await sendPayrollToEmployee(
      verified.value.adminDb,
      employeeId,
      month,
      verified.value.userDoc,
      { payrollId: payrollRecordId },
    );

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to send payslip.";
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? Number((error as { status: number }).status)
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
