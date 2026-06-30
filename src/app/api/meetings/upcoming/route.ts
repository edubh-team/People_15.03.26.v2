import { listMeetings } from "@/lib/server/meetings/service";
import { noStoreJson, toMeetingApiErrorResponse } from "@/lib/server/meetings/http";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  try {
    const payload = await listMeetings(
      verified.value.adminDb,
      verified.value.userDoc,
      "upcoming",
    );
    return noStoreJson({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.error("Upcoming meetings error:", error);
    return toMeetingApiErrorResponse(error, "Unable to load upcoming meetings.");
  }
}
