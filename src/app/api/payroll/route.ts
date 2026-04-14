import { NextResponse } from "next/server";
import { listPayrollForMonth } from "@/lib/server/payroll-service";
import { requirePayrollRequestUser } from "@/lib/server/request-auth";

export const runtime = "nodejs";

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const verified = await requirePayrollRequestUser(req);
  if (!verified.ok) return verified.response;

  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month")?.trim() || getCurrentMonthKey();
    const payload = await listPayrollForMonth(verified.value.adminDb, month);

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load payroll.";
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
