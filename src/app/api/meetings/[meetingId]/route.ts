import { getMeetingById } from "@/lib/server/meetings/service";
import { noStoreJson, toMeetingApiErrorResponse } from "@/lib/server/meetings/http";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  try {
    const { meetingId } = await context.params;
    const meeting = await getMeetingById(
      verified.value.adminDb,
      verified.value.userDoc,
      meetingId,
    );
    return noStoreJson({
      success: true,
      meeting,
    });
  } catch (error) {
    console.error("Meeting detail error:", error);
    return toMeetingApiErrorResponse(error, "Unable to load meeting details.");
  }
}
