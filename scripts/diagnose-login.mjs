const email = process.env.SUPER_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD;
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

async function timed(label, work) {
  const started = performance.now();
  const result = await work();
  console.log(`${label}: ${Math.round(performance.now() - started)}ms`);
  return result;
}

const authResponse = await timed("password-auth", () => fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  },
));
const authBody = await authResponse.json();
if (!authResponse.ok) throw new Error(`Password auth failed: ${authBody?.error?.message ?? authResponse.status}`);
const tokenPayload = JSON.parse(Buffer.from(authBody.idToken.split(".")[1], "base64url").toString("utf8"));
console.log(`token-project: ${tokenPayload.aud}; configured-project: ${projectId}`);

const profileResponse = await timed("firestore-profile", () => fetch(
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${authBody.localId}`,
  { headers: { authorization: `Bearer ${authBody.idToken}` } },
));
if (!profileResponse.ok) {
  const profileError = await profileResponse.text();
  throw new Error(`Profile read failed: ${profileResponse.status} ${profileError}`);
}

const sessionResponse = await timed("app-session", () => fetch(`${appUrl}/api/session/set`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: authBody.idToken }),
}));
if (!sessionResponse.ok) throw new Error(`Session creation failed: ${sessionResponse.status}`);

console.log("end-to-end: ok");
