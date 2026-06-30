import { disconnectZohoMeetingConnection } from "@/lib/server/meetings/service";
import { noStoreJson, toMeetingApiErrorResponse } from "@/lib/server/meetings/http";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const verified = await verifyBearerRequest(req);
  if (!verified.ok) return verified.response;

  try {
    const payload = await disconnectZohoMeetingConnection(
      verified.value.adminDb,
      verified.value.userDoc,
    );
    return noStoreJson({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.error("Zoho disconnect error:", error);
    return toMeetingApiErrorResponse(error, "Unable to disconnect Zoho Meeting.");
  }
}
