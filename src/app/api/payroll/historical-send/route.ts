import { NextResponse } from "next/server";
import {
  approvePayrollRecord,
  sendPayrollToEmployee,
} from "@/lib/server/payroll-service";
import { requirePayrollRequestUser } from "@/lib/server/request-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const verified = await requirePayrollRequestUser(req);
  if (!verified.ok) return verified.response;

  try {
    const body = (await req.json()) as Partial<{
      employeeId: string;
      month: string;
    }>;

    const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
    const month = typeof body.month === "string" ? body.month : "";

    await approvePayrollRecord(verified.value.adminDb, employeeId, month, verified.value.userDoc);
    const payload = await sendPayrollToEmployee(
      verified.value.adminDb,
      employeeId,
      month,
      verified.value.userDoc,
    );

    return NextResponse.json(payload, {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to backfill and send historical payslip.";
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
