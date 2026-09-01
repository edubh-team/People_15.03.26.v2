import { readFile } from "node:fs/promises";
import { google } from "googleapis";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey?.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
if (privateKey?.startsWith("'") && privateKey.endsWith("'")) privateKey = privateKey.slice(1, -1);
privateKey = privateKey?.replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) throw new Error("Firebase service-account credentials are incomplete");

const auth = new google.auth.JWT({
  email: clientEmail,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
const rulesApi = google.firebaserules({ version: "v1", auth });
const content = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

const created = await rulesApi.projects.rulesets.create({
  name: `projects/${projectId}`,
  requestBody: { source: { files: [{ name: "firestore.rules", content }] } },
});
const rulesetName = created.data.name;
if (!rulesetName) throw new Error("Rules API did not return a ruleset name");

await rulesApi.projects.releases.patch({
  name: `projects/${projectId}/releases/cloud.firestore`,
  requestBody: {
    release: {
      name: `projects/${projectId}/releases/cloud.firestore`,
      rulesetName,
    },
    updateMask: "ruleset_name",
  },
});

console.log(`deployed ${rulesetName}`);
