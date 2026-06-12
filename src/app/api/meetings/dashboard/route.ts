import { getMeetingsDashboard } from "@/lib/server/meetings/service";
import { noStoreJson, toMeetingApiErrorResponse } from "@/lib/server/meetings/http";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  try {
    const payload = await getMeetingsDashboard(
      verified.value.adminDb,
      verified.value.userDoc,
    );
    return noStoreJson({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.error("Meetings dashboard error:", error);
    return toMeetingApiErrorResponse(error, "Unable to load meetings dashboard.");
  }
}
