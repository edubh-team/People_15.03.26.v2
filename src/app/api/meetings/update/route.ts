import { updateMeeting } from "@/lib/server/meetings/service";
import { noStoreJson, toMeetingApiErrorResponse } from "@/lib/server/meetings/http";
import { verifyBearerRequest } from "@/lib/server/request-auth";
import type { UpdateMeetingInput } from "@/lib/types/meetings";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  try {
    const body = (await req.json()) as UpdateMeetingInput;
    const meeting = await updateMeeting(
      verified.value.adminDb,
      verified.value.userDoc,
      body,
    );
    return noStoreJson({
      success: true,
      meeting,
      message: "Meeting updated successfully.",
    });
  } catch (error) {
    console.error("Update meeting error:", error);
    return toMeetingApiErrorResponse(error, "Unable to update meeting.");
  }
}
