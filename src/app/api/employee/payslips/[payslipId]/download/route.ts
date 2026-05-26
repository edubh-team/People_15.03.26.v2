import { NextResponse } from "next/server";
import { generatePayrollPdf } from "@/lib/server/payroll-pdf";
import {
  getEmployeePayslipDetails,
  recordEmployeePayslipDownload,
} from "@/lib/server/payroll-service";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    payslipId: string;
  }>;
};

function getRequestIp(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  return forwardedFor || realIp || null;
}

function getRequestDevice(req: Request) {
  return req.headers.get("user-agent")?.trim() || null;
}

export async function GET(req: Request, context: RouteContext) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  try {
    const { payslipId } = await context.params;
    const details = await getEmployeePayslipDetails(
      verified.value.adminDb,
      payslipId,
      verified.value.userDoc,
    );

    await recordEmployeePayslipDownload(
      verified.value.adminDb,
      payslipId,
      verified.value.userDoc,
      {
        ip: getRequestIp(req),
        device: getRequestDevice(req),
      },
    );

    const pdfBuffer = await generatePayrollPdf({
      employee: details.payroll.employee,
      attendanceSummary: details.payroll.attendanceSummary,
      salaryTemplate: details.payroll.salaryTemplate,
      payroll: details.payroll,
      exists: true,
      versionHistory: [],
    });

    const filename = `payslip_${details.payroll.employee.employeeId}_${details.payroll.month}.pdf`;
    return new NextResponse(pdfBuffer as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to download payslip.";
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
