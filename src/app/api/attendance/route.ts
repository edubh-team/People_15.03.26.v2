import { NextRequest, NextResponse } from "next/server";
import { performAttendanceAction } from "@/lib/server/attendance-service";
import { verifyBearerRequest } from "@/lib/server/request-auth";
import type { GeoLocation } from "@/lib/types/attendance";

export const runtime = "nodejs";

type AttendanceRouteBody = {
  action?: string;
  location?: GeoLocation;
};

export async function POST(req: NextRequest) {
  try {
    const verified = await verifyBearerRequest(req);
    if (!verified.ok) return verified.response;

    const body = (await req.json()) as AttendanceRouteBody;
    if (!body?.action) {
      return NextResponse.json({ error: "Attendance action is required." }, { status: 400 });
    }

    const result = await performAttendanceAction(verified.value.adminDb, verified.value.userDoc, {
      action: body.action as
        | "check_in"
        | "check_out"
        | "start_break"
        | "end_break"
        | "mark_on_leave"
        | "attach_location",
      location: body.location,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process attendance action.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
