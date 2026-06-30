import { NextResponse } from "next/server";
import { getEmployeePayslipDetails } from "@/lib/server/payroll-service";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    payslipId: string;
  }>;
};

export async function GET(req: Request, context: RouteContext) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  try {
    const { payslipId } = await context.params;
    const payload = await getEmployeePayslipDetails(
      verified.value.adminDb,
      payslipId,
      verified.value.userDoc,
    );

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load payslip details.";
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
