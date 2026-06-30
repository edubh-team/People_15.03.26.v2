import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
);

let firebaseApp: ReturnType<typeof initializeApp> | null = null;
let auth: ReturnType<typeof getAuth> | null = null;
let db: ReturnType<typeof getFirestore> | null = null;
let storage: ReturnType<typeof getStorage> | null = null;
let functions: ReturnType<typeof getFunctions> | null = null;
let googleProvider: GoogleAuthProvider | null = null;
let firebaseInitError: string | null = null;

if (isFirebaseConfigured) {
  try {
    firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    storage = getStorage(firebaseApp);
    functions = getFunctions(firebaseApp);
    googleProvider = new GoogleAuthProvider();
    
    try {
      // Prefer explicit initialization to avoid WebChannel aborts behind proxies/VPNs
      db = initializeFirestore(firebaseApp, {
        experimentalAutoDetectLongPolling: true,
        ignoreUndefinedProperties: true,
      }) as unknown as ReturnType<typeof getFirestore>;
    } catch {
      db = getFirestore(firebaseApp);
    }
  } catch (err) {
    firebaseInitError = err instanceof Error ? err.message : "Firebase init error";
    firebaseApp = null;
    auth = null;
    db = null;
    storage = null;
    googleProvider = null;
  }
}

export const isFirebaseReady = isFirebaseConfigured && !firebaseInitError;

export { auth, db, storage, functions, firebaseApp, googleProvider, firebaseInitError };
