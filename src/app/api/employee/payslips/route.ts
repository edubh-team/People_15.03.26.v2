import { NextResponse } from "next/server";
import { listEmployeePayslips } from "@/lib/server/payroll-service";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  try {
    const payload = await listEmployeePayslips(
      verified.value.adminDb,
      verified.value.userDoc,
    );

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load employee payslips.";
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
