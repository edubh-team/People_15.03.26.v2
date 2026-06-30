import nodemailer from 'nodemailer';
import { sendGmail } from './gmail-transport';

// Helper for Standard SMTP (Nodemailer)
const sendSmtp = async (to: string, subject: string, html: string) => {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  
  // Extract pure email for auth user if SMTP_USER is not explicitly set
  let user = process.env.SMTP_USER;
  if (!user) {
    const fromEnv = process.env.SMTP_FROM || 'onboarding@edubh.com';
    const match = fromEnv.match(/<([^>]+)>/);
    user = match ? match[1] : fromEnv.trim().replace(/^["']|["']$/g, '');
  }

  const pass = process.env.SMTP_PASS;

  if (!pass) {
    throw new Error('Missing SMTP_PASS environment variable for SMTP transport.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port: 587, // Standard TLS port
    secure: false, // true for 465, false for other ports
    auth: {
      user,
      pass,
    },
    // Add Timeouts to fail fast if blocked
    connectionTimeout: 10000, // 10s
    greetingTimeout: 5000,    // 5s
    socketTimeout: 15000,     // 15s
  });

  // Verify connection config (Optional: Commented out to improve performance)
  /*
  try {
    await transporter.verify();
    console.log('[Email Debug] SMTP Connection verified.');
  } catch (verifyErr) {
    console.error('[Email Debug] SMTP Connection Verification Failed:', verifyErr);
    throw verifyErr;
  }
  */

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || `"HR System" <${user}>`,
    to,
    subject,
    html,
  });

  return { messageId: info.messageId };
};

export const sendEmail = async (to: string, subject: string, html: string) => {
  console.log('--- [Email Debug] Starting Email Send Process ---');

  try {
    console.log(`[Email Debug] Attempting to send email to: ${to}`);
    
    let result;

    // Decision Logic: 
    // If SMTP_PASS is provided, we assume the user wants to use standard SMTP (e.g., App Password).
    // Otherwise, we fall back to the Gmail API (Service Account) method.
    if (process.env.SMTP_PASS) {
        console.log('[Email Debug] Strategy: Standard SMTP (App Password detected)');
        try {
            result = await sendSmtp(to, subject, html);
        } catch (smtpError) {
            console.warn('[Email Debug] SMTP Strategy Failed:', smtpError);
            console.log('[Email Debug] Attempting Fallback to Gmail API (Service Account)...');
            // Fallback to Gmail API
            result = await sendGmail(to, subject, html);
        }
    } else {
        console.log('[Email Debug] Strategy: Gmail API (Service Account)');
        result = await sendGmail(to, subject, html);
    }
    
    console.log('[Email Debug] Message sent successfully!');
    console.log('[Email Debug] Message ID:', result.messageId);
    return result;
  } catch (error) {
    console.error('[Email Debug] FATAL ERROR sending email:');
    if (error instanceof Error) {
        console.error('Message:', error.message);
        console.error('Stack:', error.stack);
    } else {
        console.error(error);
    }
    throw error;
  } finally {
      console.log('--- [Email Debug] End Email Send Process ---');
  }
};
