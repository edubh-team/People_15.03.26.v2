import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";

export const runtime = 'nodejs';

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(req: Request) {
  console.log("--- [API] /api/email/send-onboarding HIT ---");
  try {
    const body = await req.json();
    console.log("[API] Request body parsed:", { 
      email: body.email, 
      name: body.name, 
      hasPassword: !!body.password 
    });

    const { email, name, password, role } = body;

    if (!email || !password || !name) {
      console.error("[API] Missing fields:", { email: !!email, name: !!name, password: !!password });
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const subject = "Welcome to People Edubh - Your Account Details";
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://people.edubh.com";
    const loginUrl = `${baseUrl}/onboarding`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a;">Welcome to People Edubh!</h2>
        <p>Dear ${name},</p>
        <p>Your account has been successfully created. Here are your temporary login credentials:</p>
        
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 5px 0;"><strong>Temporary Password:</strong> ${password}</p>
          <p style="margin: 5px 0;"><strong>Role:</strong> ${role}</p>
        </div>

        <p>Please log in and complete your onboarding process:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginUrl}" 
             style="background-color: #0f172a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Login to Dashboard
          </a>
        </div>

        <p style="font-size: 14px; color: #64748b;">
          Note: You will be prompted to change your password upon your first login.
        </p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
        
        <p style="font-size: 12px; color: #94a3b8; text-align: center;">
          This is an automated message. Please do not reply to this email.
        </p>
      </div>
    `;

    console.log("[API] Calling sendEmail utility with timeout...");
    
    // Wrap sendEmail in a timeout to prevent hanging indefinitely
    // Reduced to 25s to fail faster than typical serverless limits (which might kill the process abruptly)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Email sending timed out after 25 seconds")), 25000)
    );

    await Promise.race([
      sendEmail(email, subject, html),
      timeoutPromise
    ]);

    console.log("[API] Email sent successfully (or queued).");
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error sending onboarding email:", error);
    
    // Google/Axios errors store the actual API response in error.response.data
    // We prioritize showing this because the top-level error object just shows the request config
    let rawError = error;
    
    // Type guard for Axios/Google API errors
    if (typeof error === 'object' && error !== null && 'response' in error) {
      const errWithResponse = error as { response?: { data?: unknown } };
      if (errWithResponse.response?.data) {
        rawError = errWithResponse.response.data;
      }
    }

    // Handle Timeout specifically with 504
    if (error instanceof Error && error.message.includes("timed out")) {
        return NextResponse.json(
            { error: error.message, raw: "The email service took too long to respond. The user was created, but the email may not have been sent." },
            { status: 504 }
        );
    }

    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : String(error),
        raw: rawError
      }, 
      { status: 500 }
    );
  }
}
