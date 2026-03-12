import { NextRequest, NextResponse } from "next/server";
import { canManageTeam } from "@/lib/access";
import { verifyBearerRequest } from "@/lib/server/request-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const verified = await verifyBearerRequest(req);
    if (!verified.ok) return verified.response;

    const { adminDb, userDoc } = verified.value;

    if (!canManageTeam(userDoc)) {
      return NextResponse.json({ leads: [] });
    }

    const leadsRef = adminDb.collection("leads");
    // Query for unassigned leads (assignedTo is null)
    const snap = await leadsRef
        .where("assignedTo", "==", null)
        .limit(200)
        .select("name", "leadId", "ownerUid", "assignedTo", "status", "statusDetail") 
        .get();

    const leads = snap.docs.map(d => {
        const data = d.data();
        return {
            id: (data.leadId || d.id) as string,
            ownerUid: (data.ownerUid || null) as string | null,
            assignedTo: (data.assignedTo || null) as string | null,
            status: (data.status || "new") as string,
            statusDetail: (data.statusDetail || null) as { currentStage?: string } | null,
            name: (data.name || "—") as string,
        };
    });

    return NextResponse.json({ leads });

  } catch (error) {
    console.error("Unassigned leads error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
