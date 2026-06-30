import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/firebase/admin";
import {
  extractWhatsappLeadInputsFromPull,
  ingestWhatsappLeads,
  verifyWhatsappMockKey,
} from "@/lib/server/whatsapp-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BodyShape = Record<string, unknown>;

function readText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStringList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export async function GET(request: Request) {
  try {
    const auth = verifyWhatsappMockKey(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.reason }, { status: 401 });
    }

    const { adminDb } = await getAdmin();
    const snapshot = await adminDb
      .collection("crm_whatsapp_ingest_events")
      .orderBy("createdAt", "desc")
      .limit(25)
      .get();

    const runs = snapshot.docs.map((docRow) => ({
      id: docRow.id,
      ...(docRow.data() as Record<string, unknown>),
    }));

    return NextResponse.json({
      ok: true,
      endpoint: "/api/integrations/whatsapp/pull",
      runs,
    });
  } catch (error) {
    console.error("WhatsApp pull status fetch failed:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch WhatsApp pull history.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = verifyWhatsappMockKey(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.reason }, { status: 401 });
    }

    const body = (await request.json()) as BodyShape;
    const leads = extractWhatsappLeadInputsFromPull(body);
    if (leads.length === 0) {
      return NextResponse.json(
        {
          error:
            "No contacts found. Send contacts[] with waId/phone/name fields for pull mock ingestion.",
        },
        { status: 400 },
      );
    }

    const { adminDb } = await getAdmin();
    const result = await ingestWhatsappLeads({
      adminDb,
      leads,
      batchId: readText(body.batchId),
      campaignName: readText(body.campaignName),
      source: readText(body.source) ?? "WhatsApp Campaign",
      tags: toStringList(body.tags),
      ownerUid: readText(body.ownerUid),
      requestId: request.headers.get("x-request-id")?.trim() ?? randomUUID(),
      rawPayload: body,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("WhatsApp pull ingest failed:", error);
    return NextResponse.json(
      {
        error: "Failed to process WhatsApp pull payload.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
