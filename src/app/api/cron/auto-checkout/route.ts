import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import { buildServerActor, writeServerAudit } from "@/lib/server/audit-log";
import { getEffectiveReportsToUid } from "@/lib/sales/hierarchy";
import type { UserDoc } from "@/lib/types/user";

export const dynamic = 'force-dynamic'; // Ensure this route is not cached

function isCronAuthorized(request: Request) {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret) return true;

  const url = new URL(request.url);
  const headerSecret = request.headers.get("x-cron-secret")?.trim();
  const querySecret = url.searchParams.get("key")?.trim();

  return headerSecret === configuredSecret || querySecret === configuredSecret;
}

export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
    }

    const { adminDb } = await getAdmin();
    if (!adminDb) {
      return NextResponse.json(
        { error: "Firebase Admin not initialized" },
        { status: 500 }
      );
    }

    // Query all users who are currently checked in or on break
    const presenceRef = adminDb.collection("presence");
    const snapshot = await presenceRef
      .where("status", "in", ["checked_in", "on_break"])
      .get();

    if (snapshot.empty) {
      try {
        await writeServerAudit(adminDb, {
          action: "SYSTEM_CHANGE",
          details: "Auto-checkout cron ran with no active check-ins.",
          actor: buildServerActor({
            uid: "cron-auto-checkout",
            displayName: "Auto Checkout Cron",
            role: "SYSTEM",
            orgRole: "SYSTEM",
          }),
          metadata: {
            processed: 0,
          },
        });
      } catch (auditError) {
        console.error("Failed to write auto-checkout audit log:", auditError);
      }

      return NextResponse.json({
        success: true,
        message: "No active check-ins found to auto-checkout.",
        count: 0,
      });
    }

    const batch = adminDb.batch();
    let count = 0;
    const errors: string[] = [];

    for (const doc of snapshot.docs) {
      try {
        const data = doc.data();
        const { uid, dateKey, breaks } = data;

        if (!uid || !dateKey) {
          console.warn(`Invalid presence doc found: ${doc.id}`);
          continue;
        }

        // Parse dateKey (YYYY-MM-DD) to construct the 8:00 PM checkout time
        const [yyyy, mm, dd] = dateKey.split("-").map(Number);
        
        // Construct date for 8:00 PM (20:00) on that specific day
        // Note: Months are 0-indexed in JavaScript Date
        const checkoutDate = new Date(yyyy, mm - 1, dd, 20, 0, 0, 0);
        const checkoutTimestamp = Timestamp.fromDate(checkoutDate);

        // Prepare updates
        const updates: any = {
          status: "checked_out",
          checkedOutAt: checkoutTimestamp,
          updatedAt: Timestamp.now(),
          autoCheckout: true, // Marker to identify system action
        };

        // If user is on break, close the open break session
        if (data.status === "on_break" && Array.isArray(breaks) && breaks.length > 0) {
          const updatedBreaks = [...breaks];
          const lastBreak = updatedBreaks[updatedBreaks.length - 1];
          
          // Only close if it doesn't have an end time
          if (lastBreak && !lastBreak.end) {
            lastBreak.end = checkoutTimestamp; // End break at checkout time
            updates.breaks = updatedBreaks;
          }
        }

        // 1. Update Presence Document
        batch.update(doc.ref, updates);

        // 2. Update Daily Attendance Record
        // Path: users/{uid}/attendance/{yyyy}/months/{mm}/days/{dateKey}
        const mmStr = String(mm).padStart(2, "0");
        const dayRef = adminDb.doc(
          `users/${uid}/attendance/${yyyy}/months/${mmStr}/days/${dateKey}`
        );
        
        // We use set with merge: true just in case the day doc is missing (unlikely if checked in)
        // or update. simpler to use update if we are sure it exists. 
        // Given presence exists, day doc should exist.
        batch.update(dayRef, updates);

        // 3. Notify assigned HR + reporting manager for visibility.
        try {
          const userSnap = await adminDb.collection("users").doc(uid).get();
          if (userSnap.exists) {
            const user = ({ ...(userSnap.data() as UserDoc), uid } as UserDoc);
            const reportingManagerId = getEffectiveReportsToUid(user);
            const recipients = new Set<string>();
            if (user.assignedHR) recipients.add(user.assignedHR);
            if (reportingManagerId) recipients.add(reportingManagerId);
            recipients.delete(uid);

            const actorLabel = user.displayName || user.email || uid;
            const timeLabel = checkoutDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const dateLabel = checkoutDate.toLocaleDateString();
            for (const recipientUid of recipients) {
              const notificationRef = adminDb.collection("notifications").doc();
              batch.set(notificationRef, {
                recipientUid,
                title: `Attendance: ${actorLabel} auto checked out`,
                body: `${actorLabel} auto checked out at ${timeLabel} on ${dateLabel}.`,
                read: false,
                priority: "medium",
                type: "attendance_event",
                attendanceEventType: "check_out",
                actorUid: uid,
                actorName: actorLabel,
                autoCheckout: true,
                createdAt: Timestamp.now(),
              });
            }
          }
        } catch (notifyError) {
          console.warn(`Attendance notification skipped for ${uid}:`, notifyError);
        }

        count++;
      } catch (err: any) {
        console.error(`Error processing user ${doc.id}:`, err);
        errors.push(`User ${doc.id}: ${err.message}`);
      }
    }

    // Commit batch if there are updates
    if (count > 0) {
      await batch.commit();
    }

    try {
      await writeServerAudit(adminDb, {
        action: "SYSTEM_CHANGE",
        details: `Auto-checkout cron processed ${count} active check-ins.`,
        actor: buildServerActor({
          uid: "cron-auto-checkout",
          displayName: "Auto Checkout Cron",
          role: "SYSTEM",
          orgRole: "SYSTEM",
        }),
        metadata: {
          processed: count,
          errors,
        },
      });
    } catch (auditError) {
      console.error("Failed to write auto-checkout audit log:", auditError);
    }

    return NextResponse.json({
      success: true,
      processed: count,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error("Auto-checkout cron failed:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
