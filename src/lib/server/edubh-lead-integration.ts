import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const MAX_TEXT_LENGTH = 500;

export type EdubhLeadPayload = {
  version: 1;
  applicationId: string;
  submittedAt: number;
  batch?: {
    batchId: string;
    batchName: string;
    sourceTag: string;
    campaignName: string | null;
    batchTags: string[];
  };
  application: {
    fullName: string;
    email: string;
    phone: string;
    state: string;
    program: string;
    qualification?: string;
    preferredUniversity?: string;
    budget?: string;
    customBudget?: string;
    preferredSession?: string;
    customPreferredSession?: string;
    lastPassingPercentage?: string;
    callbackDate?: string;
    callbackTime?: string;
    leadSource?: string;
    utmAttribution?: Record<string, unknown>;
  };
};

function text(value: unknown, required = false) {
  if (typeof value !== "string") {
    if (required) throw new Error("Required text field is missing");
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized && required) throw new Error("Required text field is empty");
  if (normalized.length > MAX_TEXT_LENGTH) throw new Error("Text field is too long");
  return normalized || null;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseEdubhLeadPayload(value: unknown): EdubhLeadPayload {
  const root = record(value);
  const application = record(root?.application);
  const batch = record(root?.batch);
  if (!root || !application || root.version !== 1) {
    throw new Error("Unsupported or invalid integration payload");
  }

  const submittedAt = Number(root.submittedAt);
  if (!Number.isFinite(submittedAt) || submittedAt <= 0) {
    throw new Error("Invalid submittedAt value");
  }

  const applicationId = text(root.applicationId, true) as string;
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(applicationId)) {
    throw new Error("Invalid applicationId");
  }

  const batchTags = Array.isArray(batch?.batchTags)
    ? Array.from(new Set(batch.batchTags.map((tag) => text(tag)).filter((tag): tag is string => Boolean(tag)))).slice(0, 20)
    : [];
  const parsedBatch = batch
    ? {
        batchId: text(batch.batchId, true) as string,
        batchName: text(batch.batchName, true) as string,
        sourceTag: text(batch.sourceTag, true) as string,
        campaignName: text(batch.campaignName),
        batchTags,
      }
    : undefined;
  if (parsedBatch && parsedBatch.batchTags.length === 0) {
    throw new Error("At least one batch tag is required");
  }

  return {
    version: 1,
    applicationId,
    submittedAt,
    batch: parsedBatch,
    application: {
      fullName: text(application.fullName, true) as string,
      email: text(application.email, true) as string,
      phone: text(application.phone, true) as string,
      state: text(application.state, true) as string,
      program: text(application.program, true) as string,
      qualification: text(application.qualification) ?? undefined,
      preferredUniversity: text(application.preferredUniversity) ?? undefined,
      budget: text(application.budget) ?? undefined,
      customBudget: text(application.customBudget) ?? undefined,
      preferredSession: text(application.preferredSession) ?? undefined,
      customPreferredSession: text(application.customPreferredSession) ?? undefined,
      lastPassingPercentage: text(application.lastPassingPercentage) ?? undefined,
      callbackDate: text(application.callbackDate) ?? undefined,
      callbackTime: text(application.callbackTime) ?? undefined,
      leadSource: text(application.leadSource) ?? undefined,
      utmAttribution: record(application.utmAttribution),
    },
  };
}

export function verifyEdubhSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  now?: number;
}) {
  if (!input.timestamp || !input.signature || !/^\d+$/.test(input.timestamp)) return false;
  const timestampSeconds = Number(input.timestamp);
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) return false;

  const suppliedHex = input.signature.startsWith("sha256=")
    ? input.signature.slice("sha256=".length)
    : input.signature;
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) return false;

  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`, "utf8")
    .digest();
  const supplied = Buffer.from(suppliedHex, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "") || null;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase() || null;
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase() || null;
}

function titleCase(value: string) {
  return value.toLowerCase().replace(/(?:^|\s)\S/g, (character) => character.toUpperCase());
}

function parseCourseFees(application: EdubhLeadPayload["application"]) {
  const raw = application.budget === "Custom amount" ? application.customBudget : application.budget;
  if (!raw) return null;
  const numeric = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function parseFollowUp(application: EdubhLeadPayload["application"]) {
  if (!application.callbackDate) return { date: null, dateKey: null };
  const time = application.callbackTime && /^\d{2}:\d{2}/.test(application.callbackTime)
    ? application.callbackTime.slice(0, 5)
    : "09:00";
  const value = new Date(`${application.callbackDate}T${time}:00+05:30`);
  if (Number.isNaN(value.getTime())) return { date: null, dateKey: null };
  return { date: value, dateKey: application.callbackDate };
}

async function findDuplicateLeadIds(
  adminDb: Firestore,
  normalizedPhone: string | null,
  normalizedEmail: string | null,
) {
  const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
  if (normalizedPhone) {
    queries.push(adminDb.collection("leads").where("normalizedPhone", "==", normalizedPhone).limit(5).get());
  }
  if (normalizedEmail) {
    queries.push(adminDb.collection("leads").where("normalizedEmail", "==", normalizedEmail).limit(5).get());
  }
  const snapshots = await Promise.all(queries);
  return Array.from(new Set(snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => doc.id))));
}

export async function ingestEdubhLead(adminDb: Firestore, payload: EdubhLeadPayload) {
  const integrationId = `edubh_${payload.applicationId}`;
  const leadHash = createHash("sha256").update(integrationId).digest("hex").slice(0, 20).toUpperCase();
  const leadId = `WEB-${leadHash}`;
  const integrationRef = adminDb.collection("integration_events").doc(integrationId);
  const leadRef = adminDb.collection("leads").doc(leadId);
  const timelineRef = leadRef.collection("timeline").doc(`created_${integrationId}`);
  const normalizedPhone = normalizePhone(payload.application.phone);
  const normalizedEmail = normalizeEmail(payload.application.email);
  const normalizedName = normalizeName(payload.application.fullName);
  const duplicateLeadIds = (await findDuplicateLeadIds(adminDb, normalizedPhone, normalizedEmail))
    .filter((candidateId) => candidateId !== leadId);
  const followUp = parseFollowUp(payload.application);
  const submittedAt = admin.firestore.Timestamp.fromMillis(payload.submittedAt);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const source = payload.batch?.sourceTag || payload.application.leadSource || "edubh.com";
  const importBatchId = payload.batch?.batchId || integrationId;
  const importBatchName = payload.batch?.batchName || "EduBH Website";
  const campaignName = payload.batch?.campaignName || null;
  const importTags = payload.batch?.batchTags ?? ["Website", "edubh.com"];
  const importTagsNormalized = importTags.map((tag) => tag.toLowerCase());
  const actor = {
    uid: "integration:edubh.com",
    name: "edubh.com Website",
    role: "SYSTEM",
    employeeId: null,
  };

  const result = await adminDb.runTransaction(async (transaction) => {
    const existingEvent = await transaction.get(integrationRef);
    if (existingEvent.exists) {
      const existingLeadId = String(existingEvent.get("leadId") || leadId);
      return { leadId: existingLeadId, created: false };
    }

    transaction.create(leadRef, {
      leadId,
      externalLeadId: payload.applicationId,
      externalSystem: "edubh.com",
      name: titleCase(payload.application.fullName),
      phone: payload.application.phone,
      email: normalizedEmail,
      normalizedPhone,
      normalizedEmail,
      normalizedName,
      currentEducation: payload.application.qualification ?? null,
      targetDegree: payload.application.program,
      targetUniversity: payload.application.preferredUniversity ?? null,
      leadLocation: payload.application.state,
      courseFees: parseCourseFees(payload.application),
      preferredSession: payload.application.preferredSession ?? null,
      customPreferredSession: payload.application.customPreferredSession ?? null,
      lastPassingPercentage: payload.application.lastPassingPercentage ?? null,
      source,
      sourceNormalized: source.toLowerCase(),
      campaignName,
      utmAttribution: payload.application.utmAttribution ?? null,
      status: "new",
      subStatus: null,
      assignedTo: null,
      ownerUid: null,
      assignedBy: null,
      assignedAt: null,
      custodyState: "pooled",
      custodyReason: "Lead received from edubh.com shared pool",
      custodyUpdatedAt: now,
      mergeState: "active",
      duplicateFlag: duplicateLeadIds.length > 0,
      duplicateReasons: duplicateLeadIds.length > 0 ? ["Matching phone or email"] : null,
      duplicateCandidateLeadIds: duplicateLeadIds.length > 0 ? duplicateLeadIds : null,
      duplicateScore: duplicateLeadIds.length > 0 ? 100 : null,
      duplicateDetectedAt: duplicateLeadIds.length > 0 ? now : null,
      duplicateDetectionSource: duplicateLeadIds.length > 0 ? "create" : null,
      nextFollowUp: followUp.date ? admin.firestore.Timestamp.fromDate(followUp.date) : null,
      nextFollowUpDateKey: followUp.dateKey,
      createdDateKey: new Date(payload.submittedAt).toISOString().slice(0, 10),
      submittedAt,
      importedAt: now,
      importedBy: actor,
      importBatchId,
      importBatchName,
      importTags,
      importTagsNormalized,
      remarks: `Website application ${payload.applicationId}`,
      activityHistory: [{ type: "created", at: submittedAt, note: "Received from edubh.com" }],
      history: [{
        action: "Lead Created",
        newStatus: "new",
        remarks: "Received from edubh.com and added to shared manager pool",
        updatedBy: actor.uid,
        updatedByName: actor.name,
        timestamp: submittedAt,
      }],
      kycData: { aadhar: null, pan: null, address: null, parentDetails: null },
      createdBy: actor,
      createdAt: submittedAt,
      updatedAt: now,
      lastActionBy: actor.uid,
      lastActionAt: now,
    });

    transaction.create(timelineRef, {
      type: "created",
      summary: "Lead received from edubh.com and added to the shared pool",
      actor,
      metadata: {
        applicationId: payload.applicationId,
        source,
        importBatchId,
        importBatchName,
        campaignName,
        importTags,
        duplicateFlag: duplicateLeadIds.length > 0,
      },
      createdAt: now,
    });

    transaction.create(integrationRef, {
      integrationId,
      source: "edubh.com",
      applicationId: payload.applicationId,
      leadId,
      status: "completed",
      receivedAt: now,
    });

    return { leadId, created: true };
  });

  return { ...result, duplicateFlag: duplicateLeadIds.length > 0 };
}
