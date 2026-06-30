import { NextResponse } from "next/server";
import { isAdminUser, isHrUser } from "@/lib/access";
import {
  getPayrollDetails,
  resolvePayrollOwnership,
  savePayrollRecord,
} from "@/lib/server/payroll-service";
import { verifyBearerRequest } from "@/lib/server/request-auth";
import type { SavePayrollRequest } from "@/lib/types/payroll";

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
    if (!canAdminister && (!payload.exists || !payload.payroll.isVisibleToEmployee)) {
      return NextResponse.json({ error: "Payslip is not available yet." }, { status: 403 });
    }

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

export async function PATCH(req: Request, context: RouteContext) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  const canAdminister =
    isHrUser(verified.value.userDoc) || isAdminUser(verified.value.userDoc);
  if (!canAdminister) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { employeeId, month } = await context.params;
    const body = (await req.json()) as Partial<SavePayrollRequest>;
    const payload = await savePayrollRecord(
      verified.value.adminDb,
      {
        employeeId,
        month,
        attendanceOverride: body.attendanceOverride ?? null,
        salaryOverride: body.salaryOverride ?? null,
        saveAsTemplate: Boolean(body.saveAsTemplate),
        finalizeGeneration: Boolean(body.finalizeGeneration),
      },
      verified.value.userDoc,
    );

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to save payroll.";
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
