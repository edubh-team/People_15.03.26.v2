import { NextResponse } from "next/server";
import { isAdminUser, isHrUser } from "@/lib/access";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    recordId: string;
  }>;
};

export async function GET(req: Request, context: RouteContext) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  try {
    const { recordId } = await context.params;
    const snap = await verified.value.adminDb.collection("payroll_records").doc(recordId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Payroll record not found." }, { status: 404 });
    }

    const payload = { ...(snap.data() ?? {}), id: snap.id } as Record<string, unknown>;
    const isPrivileged =
      isHrUser(verified.value.userDoc) || isAdminUser(verified.value.userDoc);

    if (!isPrivileged && payload.uid !== verified.value.userDoc.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load payroll record.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
