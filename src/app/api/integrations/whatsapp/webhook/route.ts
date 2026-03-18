import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/firebase/admin";
import {
  extractWhatsappLeadInputsFromWebhook,
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

function validateWebhookHandshake(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const challenge = url.searchParams.get("hub.challenge");
  const token = url.searchParams.get("hub.verify_token");
  const configuredToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();

  if (mode !== "subscribe" || !challenge) return null;
  if (!configuredToken) {
    return NextResponse.json(
      { error: "WHATSAPP_VERIFY_TOKEN is not configured on server." },
      { status: 500 },
    );
  }
  if (!token || token !== configuredToken) {
    return NextResponse.json({ error: "Webhook verify token mismatch." }, { status: 403 });
  }
  return new Response(challenge, { status: 200 });
}

export async function GET(request: Request) {
  const handshake = validateWebhookHandshake(request);
  if (handshake) return handshake;

  return NextResponse.json({
    ok: true,
    endpoint: "/api/integrations/whatsapp/webhook",
    mode: "mock-ready",
    notes: [
      "GET with hub.* query params handles WhatsApp verification challenge.",
      "POST accepts mock payload.events[] or Meta webhook payload.entry[].changes[].value.messages[].",
    ],
  });
}

export async function POST(request: Request) {
  try {
    const auth = verifyWhatsappMockKey(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.reason }, { status: 401 });
    }

    const body = (await request.json()) as BodyShape;
    const leads = extractWhatsappLeadInputsFromWebhook(body);
    if (leads.length === 0) {
      return NextResponse.json(
        {
          error:
            "No valid WhatsApp contacts found in payload. Provide events[] (mock) or entry[].changes[].value.messages[] (Meta webhook).",
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
    console.error("WhatsApp webhook ingest failed:", error);
    return NextResponse.json(
      {
        error: "Failed to process WhatsApp webhook payload.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
