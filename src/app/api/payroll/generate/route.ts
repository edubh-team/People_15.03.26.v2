import { NextResponse } from "next/server";
import { generatePayrollRecord } from "@/lib/server/payroll-service";
import { requirePayrollRequestUser } from "@/lib/server/request-auth";
import type { GeneratePayrollRequest } from "@/lib/types/payroll";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const verified = await requirePayrollRequestUser(req);
  if (!verified.ok) return verified.response;

  try {
    const body = (await req.json()) as Partial<GeneratePayrollRequest>;
    const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
    const month = typeof body.month === "string" ? body.month : "";
    const bonus = typeof body.bonus === "number" ? body.bonus : 0;

    const payload = await generatePayrollRecord(verified.value.adminDb, {
      employeeId,
      month,
      bonus,
    });

    return NextResponse.json(payload, {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate payroll.";
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
