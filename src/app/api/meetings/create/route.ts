import { createMeeting } from "@/lib/server/meetings/service";
import { noStoreJson, toMeetingApiErrorResponse } from "@/lib/server/meetings/http";
import { verifyBearerRequest } from "@/lib/server/request-auth";
import type { CreateMeetingInput } from "@/lib/types/meetings";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  try {
    const body = (await req.json()) as CreateMeetingInput;
    const meeting = await createMeeting(
      verified.value.adminDb,
      verified.value.userDoc,
      body,
    );
    return noStoreJson({
      success: true,
      meeting,
      message: "Meeting created successfully.",
    }, 201);
  } catch (error) {
    console.error("Create meeting error:", error);
    return toMeetingApiErrorResponse(error, "Unable to create meeting.");
  }
}
