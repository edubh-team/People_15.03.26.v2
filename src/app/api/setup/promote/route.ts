import { NextResponse } from "next/server";
import admin from "firebase-admin";
import { buildServerActor, writeServerAudit } from "@/lib/server/audit-log";

export const runtime = "nodejs"; // Force Node.js runtime for Firebase Admin

function getConfiguredSetupSecret() {
  return process.env.SETUP_SECRET?.trim() || process.env.NEXT_PUBLIC_SETUP_KEY?.trim() || null;
}

export async function POST(request: Request) {
  try {
    const { email, secretKey } = await request.json();

    // 1. Validate Secret Key
    const configuredSecret = getConfiguredSetupSecret();
    if (!configuredSecret) {
      return NextResponse.json(
        { error: "Setup secret is not configured on the server." },
        { status: 500 }
      );
    }

    if (secretKey !== configuredSecret) {
      return NextResponse.json(
        { error: "Invalid Master Secret Key" },
        { status: 401 }
      );
    }

    // 2. Initialize Admin SDK Locally
    let adminApp: admin.app.App;
    if (admin.apps.length > 0 && admin.apps[0]) {
      adminApp = admin.apps[0];
    } else {
      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
      
      let privateKey = process.env.FIREBASE_PRIVATE_KEY;
      if (privateKey) {
        if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || 
            (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
          privateKey = privateKey.slice(1, -1);
        }
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      if (projectId && clientEmail && privateKey) {
        try {
          adminApp = admin.initializeApp({
            credential: admin.credential.cert({
              projectId,
              clientEmail,
              privateKey,
            }),
          });
        } catch (e) {
          console.error("Failed to initialize Firebase Admin with credentials:", e);
          return NextResponse.json(
            { error: "Failed to initialize Firebase Admin" },
            { status: 500 }
          );
        }
      } else {
        // Fallback or error
        console.warn("Missing Firebase credentials in environment variables.");
        // Try default init (ADC) but expect failure if not set up
        try {
          adminApp = admin.initializeApp();
        } catch {
          return NextResponse.json(
            { error: "Server configuration error: Missing Firebase Credentials." },
            { status: 500 }
          );
        }
      }
    }

    const adminDb = admin.firestore(adminApp);
    const adminAuth = admin.auth(adminApp);

    // 3. Find User by Email
    const usersRef = adminDb.collection("users");
    const snapshot = await usersRef.where("email", "==", email).get();

    if (snapshot.empty) {
      return NextResponse.json(
        { error: `User with email '${email}' not found.` },
        { status: 404 }
      );
    }

    const userDoc = snapshot.docs[0];
    const uid = userDoc.id;

    // 4. Update Firestore Document
    await userDoc.ref.update({
      role: "admin",
      orgRole: "SUPER_ADMIN",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 5. Set Custom Claims (Refresh token required on client to see changes immediately)
    await adminAuth.setCustomUserClaims(uid, {
      role: "admin",
      orgRole: "SUPER_ADMIN",
    });

    try {
      await writeServerAudit(adminDb, {
        action: "PROMOTE_USER",
        details: `Promoted ${email} to SUPER_ADMIN via setup route`,
        actor: buildServerActor({
          uid: "setup-route",
          displayName: "Setup Route",
          role: "SYSTEM",
          orgRole: "SYSTEM",
        }),
        metadata: {
          uid,
          email,
        },
      });
    } catch (auditError) {
      console.error("Failed to write setup promotion audit log:", auditError);
    }

    return NextResponse.json({ success: true, message: "User promoted successfully." });

  } catch (error: unknown) {
    console.error("Promotion Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
