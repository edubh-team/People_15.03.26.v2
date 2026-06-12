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
      "history",
    );
    return noStoreJson({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.error("Meeting history error:", error);
    return toMeetingApiErrorResponse(error, "Unable to load meeting history.");
  }
}
