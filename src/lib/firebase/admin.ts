import "server-only";
import admin from "firebase-admin";
import type { ServiceAccount } from "firebase-admin";
import type { App } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";

// Helper to get environment variables safely
const getServiceAccount = (): ServiceAccount | null => {
  // Option 1: Full JSON in one env var (common in some CI/CD)
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
      try {
          return JSON.parse(serviceAccountKey);
      } catch (e) {
          console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY", e);
      }
  }
  
  // Option 2: Individual variables (common in Vercel)
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  
  // Handle newlines in private key which are often escaped in env vars
  // Also handle double-escaped newlines (\\n) which can happen in some environments
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey) {
    // Robust Key Sanitization
    // 1. Remove surrounding quotes if present
    if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || 
        (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
      privateKey = privateKey.slice(1, -1);
    }
    // 2. Handle literal "\n" characters
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  if (projectId && clientEmail && privateKey) {
    // Check for project ID mismatch in configuration
    if (clientEmail.includes("iam.gserviceaccount.com")) {
        // extract project id from email: service-account@project-id.iam.gserviceaccount.com
        const match = clientEmail.match(/@(.*)\.iam\.gserviceaccount\.com/);
        if (match && match[1] && match[1] !== projectId) {
             console.warn(`
                WARNING: Firebase Config Mismatch!
                NEXT_PUBLIC_FIREBASE_PROJECT_ID: ${projectId}
                FIREBASE_CLIENT_EMAIL Project: ${match[1]}
                
                The Admin SDK is being initialized with credentials for "${match[1]}" 
                but the app is configured for "${projectId}". 
                Authentication and Database operations will likely fail.
             `);
        }
    }

    return {
      projectId,
      clientEmail,
      privateKey,
    };
  } else {
    // Debug logging for missing keys (safely)
    if (!projectId) console.warn("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  }
  
  return null;
};

// Singleton instances
let adminDb: Firestore | undefined;
let adminAuth: Auth | undefined;

export async function getAdmin() {
  if (adminDb && adminAuth) {
    return { adminDb, adminAuth };
  }

  try {
    let app: App;

    if (admin.apps.length > 0 && admin.apps[0]) {
      app = admin.apps[0];
    } else {
      const serviceAccount = getServiceAccount();
      
      if (serviceAccount) {
        app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else {
        // Attempt default credentials
        try {
          app = admin.initializeApp();
        } catch {
          console.warn("Firebase Admin failed to initialize: No credentials found.");
          throw new Error("Firebase Admin failed to initialize");
        }
      }
    }

    if (app) {
      adminDb = admin.firestore(app);
      adminAuth = admin.auth(app);
    }
    
    if (!adminDb || !adminAuth) {
        throw new Error("Firebase Admin initialized but services are missing");
    }

    return { adminDb, adminAuth };
  } catch (error) {
    console.error("Firebase Admin Initialization Error:", error);
    throw error;
  }
}

