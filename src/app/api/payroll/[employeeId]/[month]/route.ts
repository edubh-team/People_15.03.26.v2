import { NextResponse } from "next/server";
import { isAdminUser, isHrUser } from "@/lib/access";
import { getPayrollDetails, resolvePayrollOwnership } from "@/lib/server/payroll-service";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    employeeId: string;
    month: string;
  }>;
};

export async function GET(req: Request, context: RouteContext) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  try {
    const { employeeId, month } = await context.params;
    const payrollId = new URL(req.url).searchParams.get("payrollId")?.trim() || undefined;
    const canAdminister =
      isHrUser(verified.value.userDoc) || isAdminUser(verified.value.userDoc);

    if (!canAdminister) {
      const ownsPayroll = await resolvePayrollOwnership(
        verified.value.adminDb,
        employeeId,
        verified.value.userDoc,
      );
      if (!ownsPayroll) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const payload = await getPayrollDetails(verified.value.adminDb, employeeId, month, {
      payrollId,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load payroll details.";
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
