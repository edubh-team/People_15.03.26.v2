import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/firebase/admin";
import {
  ingestEdubhLead,
  parseEdubhLeadPayload,
  verifyEdubhSignature,
} from "@/lib/server/edubh-lead-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const secret = process.env.EDUBH_PEOPLE_INTEGRATION_SECRET?.trim();
  if (!secret) {
    console.error("EDUBH_PEOPLE_INTEGRATION_SECRET is not configured");
    return NextResponse.json({ error: "Integration is not configured" }, { status: 503 });
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload is too large" }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload is too large" }, { status: 413 });
  }

  if (!verifyEdubhSignature({
    rawBody,
    timestamp: request.headers.get("x-edubh-timestamp"),
    signature: request.headers.get("x-edubh-signature"),
    secret,
  })) {
    return NextResponse.json({ error: "Invalid integration signature" }, { status: 401 });
  }

  try {
    const payload = parseEdubhLeadPayload(JSON.parse(rawBody));
    const { adminDb } = await getAdmin();
    const result = await ingestEdubhLead(adminDb, payload);
    return NextResponse.json(
      { success: true, leadId: result.leadId, created: result.created, duplicateFlag: result.duplicateFlag },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid lead payload";
    const isConflict = /already exists/i.test(message);
    const isClientError = /invalid|required|unsupported|missing|empty|too long/i.test(message);
    if (!isClientError && !isConflict) console.error("EduBH lead ingestion failed:", error);
    return NextResponse.json(
      { error: isClientError ? message : isConflict ? "Lead import conflict" : "Unable to import lead" },
      { status: isClientError ? 400 : isConflict ? 409 : 500 },
    );
  }
}
