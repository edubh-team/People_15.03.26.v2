import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/firebase/admin";
import { buildServerActor, writeServerAudit } from "@/lib/server/audit-log";
import { runAutoCheckout } from "@/lib/server/attendance-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isCronAuthorized(request: Request) {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret) return false;

  const url = new URL(request.url);
  const headerSecret = request.headers.get("x-cron-secret")?.trim();
  const querySecret = url.searchParams.get("key")?.trim();

  return headerSecret === configuredSecret || querySecret === configuredSecret;
}

export async function GET(request: Request) {
  try {
    if (!process.env.CRON_SECRET?.trim()) {
      return NextResponse.json(
        { error: "CRON_SECRET is not configured for auto-checkout." },
        { status: 503 },
      );
    }

    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
    }

    const { adminDb } = await getAdmin();
    if (!adminDb) {
      return NextResponse.json(
        { error: "Firebase Admin not initialized" },
        { status: 500 }
      );
    }

    const result = await runAutoCheckout(adminDb, new Date());

    try {
      await writeServerAudit(adminDb, {
        action: "SYSTEM_CHANGE",
        details:
          result.message ??
          `Auto-checkout cron processed ${result.processed} active check-ins.`,
        actor: buildServerActor({
          uid: "cron-auto-checkout",
          displayName: "Auto Checkout Cron",
          role: "SYSTEM",
          orgRole: "SYSTEM",
        }),
        metadata: {
          processed: result.processed,
          skipped: result.skipped,
          errors: result.errors,
        },
      });
    } catch (auditError) {
      console.error("Failed to write auto-checkout audit log:", auditError);
    }

    return NextResponse.json(result);

  } catch (error: unknown) {
    console.error("Auto-checkout cron failed:", error);
    const message =
      error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { error: "Internal Server Error", details: message },
      { status: 500 }
    );
  }
}
