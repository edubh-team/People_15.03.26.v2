import { NextResponse } from "next/server";
import { ZohoMeetingError } from "@/lib/server/meetings/zoho";

export function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function toMeetingApiErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof ZohoMeetingError) {
    return noStoreJson(
      {
        error: error.message,
        details: error.payload,
      },
      error.status,
    );
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  return noStoreJson({ error: message }, 500);
}
