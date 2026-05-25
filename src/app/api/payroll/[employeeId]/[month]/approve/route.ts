import { NextResponse } from "next/server";
import { approvePayrollRecord } from "@/lib/server/payroll-service";
import { requirePayrollRequestUser } from "@/lib/server/request-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    employeeId: string;
    month: string;
  }>;
};

export async function POST(req: Request, context: RouteContext) {
  const verified = await requirePayrollRequestUser(req);
  if (!verified.ok) return verified.response;

  try {
    const { employeeId, month } = await context.params;
    const payload = await approvePayrollRecord(
      verified.value.adminDb,
      employeeId,
      month,
      verified.value.userDoc,
    );

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to approve payroll.";
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
