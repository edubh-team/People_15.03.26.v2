import { NextRequest, NextResponse } from "next/server";
import { canManageTeam, isAdminUser } from "@/lib/access";
import { verifyBearerRequest } from "@/lib/server/request-auth";
import { getHierarchyScopedUsers, isActiveUser } from "@/lib/sales/hierarchy";
import type { UserDoc } from "@/lib/types/user";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const verified = await verifyBearerRequest(req);
    if (!verified.ok) return verified.response;

    const { adminDb, uid, userDoc } = verified.value;
    if (!canManageTeam(userDoc)) {
      return NextResponse.json({ stats: {} });
    }

    const usersSnap = await adminDb.collection("users").limit(1500).get();
    const allUsers = usersSnap.docs.map(
      (snapshot) => ({ ...(snapshot.data() as UserDoc), uid: snapshot.id }) as UserDoc,
    );
    const scopedUsers = isAdminUser(userDoc)
      ? allUsers
      : getHierarchyScopedUsers(userDoc, allUsers, { includeCurrentUser: false });
    const subUids = Array.from(
      new Set(
        scopedUsers
          .filter((candidate) => candidate.uid !== uid && isActiveUser(candidate))
          .map((candidate) => candidate.uid),
      ),
    );
    const stats: Record<string, { pitch: number; followUp: number; enrolled: number }> = {};
    
    // Initialize stats
    subUids.forEach(id => {
      stats[id] = { pitch: 0, followUp: 0, enrolled: 0 };
    });

    if (subUids.length > 0) {
      // Chunk uids into groups of 10 for 'in' query
      const chunks = [];
      for (let i = 0; i < subUids.length; i += 10) {
        chunks.push(subUids.slice(i, i + 10));
      }

      const leadsRef = adminDb.collection("leads");
      
      await Promise.all(chunks.map(async (chunk) => {
        // We only need statusDetail.currentStage and ownerUid
        const snap = await leadsRef
          .where("ownerUid", "in", chunk)
          .select("ownerUid", "statusDetail.currentStage") 
          .get();

        snap.forEach(d => {
          const data = d.data();
          const owner = data.ownerUid;
          const stage = (data.statusDetail?.currentStage || "").toLowerCase();
          
          if (stats[owner]) {
            if (stage.includes("pitch")) stats[owner].pitch++;
            else if (stage.includes("follow")) stats[owner].followUp++;
            else if (stage.includes("enroll")) stats[owner].enrolled++;
          }
        });
      }));
    }

    return NextResponse.json({ stats });

  } catch (error) {
    console.error("Pipeline stats error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
