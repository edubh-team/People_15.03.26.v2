import { NextResponse } from "next/server";
import { requirePayrollRequestUser } from "@/lib/server/request-auth";
import { sendPayrollToEmployee } from "@/lib/server/payroll-service";

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
    const payload = await sendPayrollToEmployee(
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
    const message = error instanceof Error ? error.message : "Failed to send payroll.";
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
