import { NextResponse } from "next/server";
import admin from "firebase-admin";
import { sendEmail } from "@/lib/email";
import { buildServerActor, writeServerAudit } from "@/lib/server/audit-log";
import { requireUserCreationRequestUser } from "@/lib/server/request-auth";

export async function POST(req: Request) {
  try {
    const verified = await requireUserCreationRequestUser(req);
    if (!verified.ok) return verified.response;

    const { adminAuth, adminDb, userDoc, uid: actorUid } = verified.value;
    const actor = buildServerActor({
      uid: actorUid,
      displayName: userDoc.displayName,
      email: userDoc.email,
      role: userDoc.role,
      orgRole: userDoc.orgRole,
    });

    const body = await req.json();
    const { email, displayName, role, status, teamLeadId, orgRole } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // 1. Create Auth User
    let uid: string;
    try {
      const userRecord = await adminAuth.createUser({
        uid: body.uid || undefined,
        email,
        displayName,
        emailVerified: false,
        disabled: false,
      });
      uid = userRecord.uid;
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'auth/email-already-exists') {
        // If user exists in Auth, try to find them by email to get UID
        const userRecord = await adminAuth.getUserByEmail(email);
        uid = userRecord.uid;
      } else {
        throw err;
      }
    }

    // 2. Create/Update Firestore Document
    const userDocRef = adminDb.collection("users").doc(uid);

    const requestedOrgRole = typeof orgRole === "string" ? orgRole : null;
    const requestedRole = typeof role === "string" ? role : "employee";
    await userDocRef.set({
      uid,
      email,
      displayName,
      role: requestedRole,
      orgRole: requestedOrgRole,
      status: status || "active",
      teamLeadId: teamLeadId || null,
      onboardingCompleted: false, // Explicitly set to false
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    // 3. Generate Password Reset Link
    let link: string;
    try {
      link = await adminAuth.generatePasswordResetLink(email);
    } catch (linkError: unknown) {
      console.error("Failed to generate password reset link:", linkError);
      const errorMessage = linkError instanceof Error ? linkError.message : "Unknown error";
      try {
        await writeServerAudit(adminDb, {
          action: "CREATE_USER",
          details: `Created user ${email} but password reset link generation failed`,
          actor,
          metadata: {
            uid,
            email,
            requestedRole,
            requestedOrgRole,
            warning: errorMessage,
          },
        });
      } catch (auditError) {
        console.error("Failed to write create-user audit log:", auditError);
      }
      // Return a partial success or specific error so the UI can handle it
      return NextResponse.json({ 
        success: true, // User is created, so technically success
        uid, 
        message: "User created, but failed to generate password reset link. Please reset password manually.",
        warning: errorMessage
      });
    }

    // 4. Send Email
    const subject = "Welcome to People Edubh - Set your account password";
    const html = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Welcome to People Edubh!</h2>
        <p>Your account has been created successfully.</p>
        <p>Please click the link below to set your password and complete your onboarding:</p>
        <p>
          <a href="${link}" style="display: inline-block; background-color: #0f172a; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Set Password & Login
          </a>
        </p>
        <p>If the button doesn't work, copy and paste this link into your browser:</p>
        <p>${link}</p>
        <br/>
        <p>Best regards,<br/>The People Edubh Team</p>
      </div>
    `;

    try {
        await sendEmail(email, subject, html);
    } catch (emailError) {
        console.error("Failed to send welcome email:", emailError);
        // We don't fail the request, but we might want to alert the admin
        // For now, we proceed as success but maybe with a message
    }

    try {
      await writeServerAudit(adminDb, {
        action: "CREATE_USER",
        details: `Created user ${email} and issued onboarding invite`,
        actor,
        metadata: {
          uid,
          email,
          requestedRole,
          requestedOrgRole,
        },
      });
    } catch (auditError) {
      console.error("Failed to write create-user audit log:", auditError);
    }

    return NextResponse.json({ success: true, uid, message: "User created and invite sent." });

  } catch (error: unknown) {
    console.error("Create User Error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
