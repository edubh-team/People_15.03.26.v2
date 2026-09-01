import admin from "firebase-admin";

const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SUPER_ADMIN_PASSWORD;
const displayName = process.env.SUPER_ADMIN_NAME?.trim() || "People Super Admin";

if (!email || !password) {
  throw new Error("SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required");
}

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey?.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
if (privateKey?.startsWith("'") && privateKey.endsWith("'")) privateKey = privateKey.slice(1, -1);
privateKey = privateKey?.replace(/\\n/g, "\n");

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
if (!projectId || !clientEmail || !privateKey) throw new Error("Firebase Admin credentials are incomplete");

const app = admin.initializeApp({
  credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
});
const auth = admin.auth(app);
const db = admin.firestore(app);

let user;
try {
  user = await auth.getUserByEmail(email);
  user = await auth.updateUser(user.uid, { password, displayName, disabled: false });
} catch (error) {
  if (error?.code !== "auth/user-not-found") throw error;
  user = await auth.createUser({ email, password, displayName, emailVerified: true, disabled: false });
}

await auth.setCustomUserClaims(user.uid, { role: "admin", orgRole: "SUPER_ADMIN" });
const ref = db.collection("users").doc(user.uid);
const existing = await ref.get();
await ref.set({
  uid: user.uid,
  email,
  displayName,
  authProvider: "email",
  role: "admin",
  orgRole: "SUPER_ADMIN",
  status: "active",
  disabled: false,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  ...(existing.exists ? {} : {
    googleId: null,
    teamLeadId: null,
    lastLogin: null,
    onboardingCompleted: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }),
}, { merge: true });

const verifiedAuth = await auth.getUser(user.uid);
const verifiedDoc = await ref.get();
const data = verifiedDoc.data();
if (verifiedAuth.customClaims?.orgRole !== "SUPER_ADMIN" || data?.orgRole !== "SUPER_ADMIN" || data?.role !== "admin") {
  throw new Error("Post-create verification failed");
}

console.log(JSON.stringify({ uid: user.uid, email, role: data.role, orgRole: data.orgRole, status: data.status }));
await app.delete();
