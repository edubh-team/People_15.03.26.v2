import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireTeamManagementRequestUser } from "@/lib/server/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ENDPOINT = "https://edubh.com/api/cron/people-lead-delivery";
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

function getRequestTimeoutMs() {
  const configured = Number(process.env.EDUBH_PEOPLE_PULL_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < 20_000) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(configured, 300_000);
}

export async function POST(request: Request) {
  const verified = await requireTeamManagementRequestUser(request);
  if (!verified.ok) return verified.response;

  const secret = process.env.EDUBH_PEOPLE_PULL_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "EduBH lead fetch is not configured on the People server." },
      { status: 503 },
    );
  }

  const endpoint = process.env.EDUBH_PEOPLE_PULL_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  const body = (await request.json().catch(() => null)) as
    | { fromDate?: string; toDate?: string; batchName?: string; sourceTag?: string; campaignName?: string | null; batchTags?: string[] }
    | null;
  const fromDate = body?.fromDate?.trim() || "";
  const toDate = body?.toDate?.trim() || "";
  const batchName = body?.batchName?.trim() || "";
  const sourceTag = body?.sourceTag?.trim() || "";
  const campaignName = body?.campaignName?.trim() || null;
  const batchTags = Array.isArray(body?.batchTags)
    ? Array.from(new Set(body.batchTags.map((tag) => String(tag).trim()).filter(Boolean))).slice(0, 20)
    : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return NextResponse.json({ error: "From date and to date are required." }, { status: 400 });
  }
  if (!batchName || !sourceTag || batchTags.length === 0) {
    return NextResponse.json({ error: "Batch name, source tag, and batch tags are required." }, { status: 400 });
  }
  const batchId = `edubh_fetch_${randomUUID()}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ fromDate, toDate, batch: { batchId, batchName, sourceTag, campaignName, batchTags } }),
      cache: "no-store",
      signal: AbortSignal.timeout(getRequestTimeoutMs()),
    });
    const result = (await response.json().catch(() => null)) as
      | { processed?: number; delivered?: number; failed?: number; skipped?: number; error?: string }
      | null;

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.error || `EduBH returned HTTP ${response.status}` },
        { status: response.status === 401 || response.status === 403 ? 502 : response.status },
      );
    }

    return NextResponse.json({
      success: true,
      processed: Number(result?.processed || 0),
      delivered: Number(result?.delivered || 0),
      failed: Number(result?.failed || 0),
      skipped: Number(result?.skipped || 0),
      batchId,
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return NextResponse.json(
      { error: timedOut ? "EduBH lead fetch timed out. Please try again." : "Unable to contact EduBH lead service." },
      { status: 502 },
    );
  }
}
