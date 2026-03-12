import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';

// Helper to get credentials from Env or File
const getCredentials = () => {
  // 1. Try Environment Variables (Preferred for Vercel/Production)
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey) {
    // Robust Key Sanitization
    // 1. Remove surrounding quotes if present (common in some env editors)
    if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || 
        (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
      privateKey = privateKey.slice(1, -1);
    }
    // 2. Handle literal "\n" characters (common in Vercel/Docker envs)
    privateKey = privateKey.replace(/\\n/g, '\n');

    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        console.warn('[Gmail Transport] Private Key missing standard header. Check FIREBASE_PRIVATE_KEY format.');
    }
  }

  if (clientEmail && privateKey) {
    return { 
      clientEmail, 
      privateKey, 
      clientId: process.env.FIREBASE_CLIENT_ID || 'Unknown (Env Var)' 
    };
  }

  // 2. Try Local File (Dev fallback)
  const keyFilePath = path.join(process.cwd(), 'service-account.json');
  if (fs.existsSync(keyFilePath)) {
    try {
      const keyFile = JSON.parse(fs.readFileSync(keyFilePath, 'utf-8'));
      
      return {
        clientEmail: keyFile.client_email,
        privateKey: keyFile.private_key,
        clientId: keyFile.client_id,
      };
    } catch (error) {
      console.error('Error reading service-account.json:', error);
    }
  }

  return null;
};

// Scopes must match what you added in Admin Console
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

export const createGmailTransporter = async () => {
  const credentials = getCredentials();
  
  if (!credentials) {
    throw new Error('No credentials found for Gmail API (Env vars or service-account.json missing)');
  }

  // Extract pure email from "Name <email>" format if necessary
  // default to onboarding@edubh.com if not set
  const smtpFrom = process.env.SMTP_FROM || 'onboarding@edubh.com';
  const match = smtpFrom.match(/<([^>]+)>/);
  const subjectEmail = match ? match[1] : smtpFrom.trim().replace(/^["']|["']$/g, '');

  // 1. Create JWT Client for Impersonation
  console.log(`[Gmail API] Initializing JWT for Service Account: ${credentials.clientEmail} acting as: ${subjectEmail}`);
  
  const auth = new google.auth.JWT({
    email: credentials.clientEmail,
    key: credentials.privateKey,
    scopes: SCOPES,
    subject: subjectEmail, // CRITICAL: This acts as the user
  });

  // 2. Get Access Token
  let accessTokenObj;
  try {
    accessTokenObj = await auth.getAccessToken();
  } catch (err: unknown) {
    console.error(`[Gmail API] Failed to get access token for ${subjectEmail}.`);
    
    // Type checking for Axios/Google API error structure
    const errWithResponse = err as { response?: { data?: unknown }, message?: string };
    
    // Debugging OpenSSL/Key issues
    if (errWithResponse.message && (errWithResponse.message.includes('OSSL') || errWithResponse.message.includes('routine'))) {
       console.error('[Gmail API] CRITICAL: OpenSSL/Key Error detected.');
       console.error(`[Gmail API] Key Length: ${credentials.privateKey.length}`);
       console.error(`[Gmail API] Key Start: ${credentials.privateKey.substring(0, 35)}...`);
       console.error(`[Gmail API] Key End: ...${credentials.privateKey.substring(credentials.privateKey.length - 35)}`);
    }

    if (typeof err === 'object' && err !== null && errWithResponse.response?.data) {
      console.error('[Gmail API] Raw Error Response:', JSON.stringify(errWithResponse.response.data, null, 2));
      
      const responseData = errWithResponse.response.data as { error?: unknown };
      if (responseData.error === 'unauthorized_client') {
        throw new Error(
          `GMAIL API ERROR: 'unauthorized_client'. \n` +
          `The Service Account (${credentials.clientEmail}) is not authorized to impersonate ${subjectEmail}.\n` +
          `FIX: Go to Google Admin Console > Security > Access and data control > API controls > Manage Domain Wide Delegation.\n` +
          `Add Client ID: ${credentials.clientId || 'Your Service Account Client ID'}\n` +
          `Scopes: https://www.googleapis.com/auth/gmail.send`
        );
      }
    } else {
      console.error('[Gmail API] Error Details:', err);
    }
    throw err; // Throw raw error as requested
  }

  const accessToken = accessTokenObj.token;

  if (!accessToken) {
    throw new Error('Failed to generate Access Token for Gmail API');
  }

  // 3. Create Nodemailer Transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: subjectEmail,
      serviceClient: credentials.clientEmail,
      privateKey: credentials.privateKey,
      accessToken: accessToken,
    },
  });

  return transporter;
};

export const sendGmail = async (to: string, subject: string, html: string) => {
  try {
    const credentials = getCredentials();
    if (!credentials) {
      throw new Error('No credentials found for Gmail API');
    }

    const smtpFrom = process.env.SMTP_FROM || 'onboarding@edubh.com';
    const match = smtpFrom.match(/<([^>]+)>/);
    const subjectEmail = match ? match[1] : smtpFrom.trim().replace(/^["']|["']$/g, '');

    // Initialize JWT for API Call (Pure REST, not SMTP)
    const auth = new google.auth.JWT({
      email: credentials.clientEmail,
      key: credentials.privateKey,
      scopes: ['https://www.googleapis.com/auth/gmail.send'],
      subject: subjectEmail,
    });

    // We can just use the googleapis library directly to avoid SMTP/Nodemailer overhead
    const gmail = google.gmail({ version: 'v1', auth });

    // Construct Raw Email (MIME)
    const nl = "\n";
    
    let mime = "";
    mime += `MIME-Version: 1.0${nl}`;
    mime += `To: ${to}${nl}`;
    mime += `From: ${smtpFrom}${nl}`;
    mime += `Subject: ${subject}${nl}`;
    mime += `Content-Type: text/html; charset=UTF-8${nl}`;
    mime += `${nl}`;
    mime += `${html}`;

    const encodedMessage = Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const res = await gmail.users.messages.send({
      userId: 'me', // 'me' refers to the impersonated user (subjectEmail)
      requestBody: {
        raw: encodedMessage,
      },
    });

    console.log('[Gmail API REST] Message sent:', res.data.id);
    return { success: true, messageId: res.data.id };

  } catch (error) {
    console.error('[Gmail API] Error:', error);
    
    // Check for Google API Errors (401/403)
    // Using unknown and type guards for safety instead of 'any'
    const errObj = error as { code?: number; response?: { status?: number } };
    
    if (errObj.code === 401 || errObj.code === 403 || (errObj.response && (errObj.response.status === 401 || errObj.response.status === 403))) {
       throw new Error(
         `GMAIL API PERMISSION ERROR: The Service Account cannot send email as '${process.env.SMTP_FROM || 'onboarding@edubh.com'}'.\n` +
         `REASON: Missing Domain-Wide Delegation or Invalid User.\n` +
         `FIX: Go to Google Admin Console > Security > API Controls > Domain-Wide Delegation and authorize Client ID: ${getCredentials()?.clientId}`
       );
    }

    throw error;
  }
};
