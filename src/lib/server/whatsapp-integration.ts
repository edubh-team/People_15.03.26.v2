import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getServerAppEnvironment } from "@/lib/env";
import { writeServerAudit } from "@/lib/server/audit-log";
import { generateLeadId, toTitleCase } from "@/lib/utils/stringUtils";
import type { LeadDoc, LeadTimelineActor, LeadTransferRecord } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";

const DEFAULT_SOURCE = "WhatsApp Inbound";
const DEFAULT_IMPORT_TAG = "WhatsApp Lead";
const INTEGRATION_UID = "whatsapp-integration";

type RecordValue = Record<string, unknown>;

type UserSummary = {
  uid: string;
  displayName: string | null;
};

export type WhatsappLeadInput = {
  waId?: string | null;
  phone?: string | null;
  name?: string | null;
  email?: string | null;
  leadLocation?: string | null;
  preferredLanguage?: string | null;
  campaignName?: string | null;
  campaignId?: string | null;
  tags?: string[] | null;
  note?: string | null;
  source?: string | null;
  ownerUid?: string | null;
  targetDegree?: string | null;
  targetUniversity?: string | null;
  currentEducation?: string | null;
  courseFees?: number | null;
  messageBody?: string | null;
  messageAt?: unknown;
  externalLeadId?: string | null;
};

export type WhatsappIngestInput = {
  adminDb: Firestore;
  leads: WhatsappLeadInput[];
  batchId?: string | null;
  campaignName?: string | null;
  source?: string | null;
  tags?: string[] | null;
  ownerUid?: string | null;
  requestId?: string | null;
  rawPayload?: unknown;
};

export type WhatsappIngestLeadResult = {
  index: number;
  leadId?: string;
  status: "created" | "updated" | "failed";
  name: string | null;
  phone: string | null;
  waId: string | null;
  reason?: string;
};

export type WhatsappIngestResult = {
  success: boolean;
  batchId: string;
  source: string;
  campaignName: string | null;
  totalReceived: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  results: WhatsappIngestLeadResult[];
};

type NormalizedWhatsappLead = {
  waId: string | null;
  phoneForLead: string | null;
  phoneCandidates: string[];
  name: string;
  email: string | null;
  leadLocation: string | null;
  preferredLanguage: string | null;
  campaignName: string | null;
  campaignId: string | null;
  tags: string[];
  note: string | null;
  source: string;
  ownerUid: string | null;
  targetDegree: string | null;
  targetUniversity: string | null;
  currentEducation: string | null;
  courseFees: number | null;
  messageBody: string | null;
  messageAt: Date | null;
  externalLeadId: string | null;
};

const INTEGRATION_ACTOR: LeadTimelineActor = {
  uid: INTEGRATION_UID,
  name: "WhatsApp Integration",
  role: "SYSTEM",
  employeeId: null,
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

function toTrimmed(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toOptionalEmail(value: unknown) {
  const trimmed = toTrimmed(value);
  return trimmed ? trimmed.toLowerCase() : null;
}

function toOptionalTitleCase(value: unknown) {
  const trimmed = toTrimmed(value);
  return trimmed ? toTitleCase(trimmed) : null;
}

function toNumberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeName(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function normalizePhoneDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function uniqueText(values: Array<string | null | undefined>) {
  const output: string[] = [];
  const seen = new Set<string>();

  values.forEach((value) => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(trimmed);
  });

  return output;
}

function normalizeTagList(tags: unknown) {
  if (!Array.isArray(tags)) return [] as string[];
  return uniqueText(
    tags
      .map((tag) => (typeof tag === "string" ? toTitleCase(tag.trim()) : null))
      .filter(Boolean),
  );
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function getTodayKey(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function createTransferRecordId(seed: string) {
  return `${seed}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBatchId(value?: string | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
}

function coerceDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const epochMillis = value < 1e12 ? value * 1000 : value;
    const parsed = new Date(epochMillis);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && /^\d+$/.test(value.trim())) {
      const epochMillis = numeric < 1e12 ? numeric * 1000 : numeric;
      const parsedEpoch = new Date(epochMillis);
      if (!Number.isNaN(parsedEpoch.getTime())) return parsedEpoch;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function buildPhoneCandidates(input: WhatsappLeadInput) {
  const waDigits = normalizePhoneDigits(input.waId ?? null);
  const phoneDigits = normalizePhoneDigits(input.phone ?? null);

  const values = uniqueText([waDigits || null, phoneDigits || null]);
  if (values.length === 0) return [] as string[];

  const candidates = new Set<string>();
  values.forEach((digits) => {
    if (!digits) return;
    candidates.add(digits);
    if (digits.length > 10) {
      candidates.add(digits.slice(-10));
    }
  });

  return Array.from(candidates).filter(Boolean);
}

function pickLeadPhone(phoneCandidates: string[]) {
  if (phoneCandidates.length === 0) return null;
  const tenDigit = phoneCandidates.find((value) => value.length === 10);
  return tenDigit ?? phoneCandidates[0] ?? null;
}

function buildContextTags(input: {
  leadLocation: string | null;
  preferredLanguage: string | null;
}) {
  return uniqueText([
    input.leadLocation ? `Location: ${input.leadLocation}` : null,
    input.preferredLanguage ? `Language: ${input.preferredLanguage}` : null,
  ]);
}

function buildHistoryEntry(input: {
  action: string;
  remarks: string;
  oldStatus?: string | null;
  newStatus?: string | null;
  actor?: LeadTimelineActor;
  timestamp?: Date;
}) {
  const actor = input.actor ?? INTEGRATION_ACTOR;
  return {
    action: input.action,
    oldStatus: input.oldStatus ?? undefined,
    newStatus: input.newStatus ?? undefined,
    remarks: input.remarks,
    updatedBy: actor.uid,
    updatedByName: actor.name ?? undefined,
    timestamp: input.timestamp ?? new Date(),
  };
}

function isActiveOperationalUser(user: UserDoc | null | undefined) {
  if (!user) return false;
  const status = String(user.status ?? "").toLowerCase();
  if (status !== "active") return false;
  const lifecycle = String(user.lifecycleState ?? "").toLowerCase();
  return lifecycle !== "terminated";
}

async function getUserSummary(
  adminDb: Firestore,
  uid: string,
  cache: Map<string, UserSummary | null>,
) {
  if (cache.has(uid)) return cache.get(uid) ?? null;
  const snapshot = await adminDb.collection("users").doc(uid).get();
  if (!snapshot.exists) {
    cache.set(uid, null);
    return null;
  }
  const user = { ...(snapshot.data() as UserDoc), uid: snapshot.id };
  if (!isActiveOperationalUser(user)) {
    cache.set(uid, null);
    return null;
  }
  const summary: UserSummary = {
    uid,
    displayName: user.displayName?.trim() || user.email?.trim() || uid,
  };
  cache.set(uid, summary);
  return summary;
}

async function queryLeadByField(
  adminDb: Firestore,
  field: string,
  values: string[],
) {
  if (values.length === 0) return null;
  if (values.length === 1) {
    const snapshot = await adminDb.collection("leads").where(field, "==", values[0]).limit(5).get();
    const row = snapshot.docs.find((docRow) => {
      const raw = docRow.data() as LeadDoc;
      return raw.mergeState !== "merged";
    });
    if (!row) return null;
    return { id: row.id, data: { ...(row.data() as LeadDoc), leadId: row.id } };
  }

  const chunk = values.slice(0, 10);
  const snapshot = await adminDb.collection("leads").where(field, "in", chunk).limit(10).get();
  const row = snapshot.docs.find((docRow) => {
    const raw = docRow.data() as LeadDoc;
    return raw.mergeState !== "merged";
  });
  if (!row) return null;
  return { id: row.id, data: { ...(row.data() as LeadDoc), leadId: row.id } };
}

async function findExistingLead(
  adminDb: Firestore,
  normalized: NormalizedWhatsappLead,
) {
  const phoneCandidates = normalized.phoneCandidates;
  const normalizedEmailValue = normalizeEmail(normalized.email);
  const emailCandidates = normalizedEmailValue ? [normalizedEmailValue] : [];

  return (
    (await queryLeadByField(adminDb, "normalizedPhone", phoneCandidates)) ??
    (await queryLeadByField(adminDb, "phone", phoneCandidates)) ??
    (await queryLeadByField(adminDb, "normalizedEmail", emailCandidates)) ??
    (await queryLeadByField(adminDb, "email", emailCandidates)) ??
    null
  );
}

async function createUniqueLeadId(adminDb: Firestore) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const leadId = generateLeadId();
    const exists = await adminDb.collection("leads").doc(leadId).get();
    if (!exists.exists) return leadId;
  }

  return `${generateLeadId()}-${Date.now().toString(36).slice(-4)}`;
}

function shouldReplaceLeadName(currentName: string | null | undefined) {
  const normalizedCurrent = normalizeName(currentName ?? "");
  if (!normalizedCurrent) return true;
  if (normalizedCurrent === "unknown") return true;
  if (normalizedCurrent === "unknown lead") return true;
  return false;
}

function normalizeWhatsappLead(
  input: WhatsappLeadInput,
  defaults: {
    source: string;
    campaignName: string | null;
    ownerUid: string | null;
  },
) {
  const phoneCandidates = buildPhoneCandidates(input);
  const phoneForLead = pickLeadPhone(phoneCandidates);
  const waId = normalizePhoneDigits(input.waId ?? null) || null;

  const source = toTrimmed(input.source) ?? defaults.source;
  const campaignName = toTrimmed(input.campaignName) ?? defaults.campaignName;
  const leadLocation = toOptionalTitleCase(input.leadLocation);
  const preferredLanguage = toOptionalTitleCase(input.preferredLanguage);
  const tags = normalizeTagList(input.tags);
  const courseFees = toNumberOrNull(input.courseFees);
  const nameCandidate = toOptionalTitleCase(input.name);

  const name =
    nameCandidate ??
    (waId ? `WhatsApp ${waId.slice(-4)}` : null) ??
    "WhatsApp Lead";

  const messageBody = toTrimmed(input.messageBody);
  const note = toTrimmed(input.note);
  const fallbackNote = messageBody
    ? `Inbound WhatsApp message: ${messageBody}`
    : "Lead captured from WhatsApp campaign";

  return {
    waId,
    phoneForLead,
    phoneCandidates,
    name,
    email: toOptionalEmail(input.email),
    leadLocation,
    preferredLanguage,
    campaignName,
    campaignId: toTrimmed(input.campaignId),
    tags,
    note: note ?? fallbackNote,
    source,
    ownerUid: toTrimmed(input.ownerUid) ?? defaults.ownerUid,
    targetDegree: toOptionalTitleCase(input.targetDegree),
    targetUniversity: toOptionalTitleCase(input.targetUniversity),
    currentEducation: toOptionalTitleCase(input.currentEducation),
    courseFees,
    messageBody,
    messageAt: coerceDate(input.messageAt),
    externalLeadId: toTrimmed(input.externalLeadId),
  } satisfies NormalizedWhatsappLead;
}

function buildInitialTransferRecord(input: {
  leadId: string;
  ownerUid: string | null;
  ownerName: string | null;
  reason: string;
}) {
  const transferRecord: LeadTransferRecord = {
    id: createTransferRecordId(input.leadId),
    custodyState: input.ownerUid ? "owned" : "pooled",
    reason: input.reason,
    previousOwnerUid: null,
    previousOwnerName: null,
    currentOwnerUid: input.ownerUid,
    currentOwnerName: input.ownerName,
    transferredBy: INTEGRATION_ACTOR,
    transferredAt: new Date(),
  };

  return transferRecord;
}

function isDuplicateMergeLead(lead: LeadDoc) {
  return lead.mergeState === "merged";
}

export function verifyWhatsappMockKey(request: Request) {
  const configuredKey = process.env.WHATSAPP_MOCK_API_KEY?.trim();
  if (!configuredKey) {
    if (getServerAppEnvironment() === "production") {
      return {
        ok: false as const,
        reason:
          "WHATSAPP_MOCK_API_KEY is required in production before enabling the WhatsApp mock API.",
      };
    }

    return { ok: true as const };
  }

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-whatsapp-mock-key")?.trim() ??
    request.headers.get("x-whatsapp-secret")?.trim() ??
    url.searchParams.get("key")?.trim() ??
    "";

  if (!provided || provided !== configuredKey) {
    return { ok: false as const, reason: "Invalid WhatsApp integration key." };
  }

  return { ok: true as const };
}

function buildImportBatchSeed(batchId: string) {
  return {
    batchId,
    fileName: "whatsapp-mock",
    sourceTag: DEFAULT_SOURCE,
    tags: [DEFAULT_IMPORT_TAG],
    tagsNormalized: [DEFAULT_IMPORT_TAG.toLowerCase()],
    createdByUid: INTEGRATION_UID,
    createdByName: "WhatsApp Integration",
    createdByRole: "SYSTEM",
  };
}

function toWebhookMessageText(message: RecordValue) {
  const type = toTrimmed(message.type) ?? "";
  if (type === "text") {
    const text = isRecord(message.text) ? toTrimmed(message.text.body) : null;
    return text;
  }
  if (type === "button") {
    const button = isRecord(message.button) ? toTrimmed(message.button.text) : null;
    return button;
  }
  if (type === "interactive") {
    const interactive = isRecord(message.interactive) ? message.interactive : null;
    if (!interactive) return null;
    const buttonReply = isRecord(interactive.button_reply) ? toTrimmed(interactive.button_reply.title) : null;
    const listReply = isRecord(interactive.list_reply) ? toTrimmed(interactive.list_reply.title) : null;
    return buttonReply ?? listReply ?? null;
  }
  return toTrimmed(message.caption) ?? null;
}

export function extractWhatsappLeadInputsFromWebhook(payload: unknown) {
  const output: WhatsappLeadInput[] = [];
  if (!isRecord(payload)) return output;

  const defaultCampaignName = toTrimmed(payload.campaignName);
  const defaultCampaignId = toTrimmed(payload.campaignId);
  const defaultTags = normalizeTagList(payload.tags);
  const defaultSource = toTrimmed(payload.source);
  const defaultOwnerUid = toTrimmed(payload.ownerUid);
  const defaultLocation = toOptionalTitleCase(payload.leadLocation);
  const defaultLanguage = toOptionalTitleCase(payload.preferredLanguage);

  // Support direct provider payloads that send messages/contacts at root level.
  const topLevelContacts = Array.isArray(payload.contacts) ? payload.contacts : [];
  const topLevelContactsByWaId = new Map<string, RecordValue>();
  topLevelContacts.forEach((contact) => {
    if (!isRecord(contact)) return;
    const waId = toTrimmed(contact.waId) ?? toTrimmed(contact.wa_id) ?? toTrimmed(contact.phone);
    if (!waId) return;
    topLevelContactsByWaId.set(waId, contact);
  });

  const topLevelMessages = Array.isArray(payload.messages) ? payload.messages : [];
  topLevelMessages.forEach((message) => {
    if (!isRecord(message)) return;
    const waId =
      toTrimmed(message.from) ??
      toTrimmed(message.waId) ??
      toTrimmed(message.wa_id) ??
      toTrimmed(message.phone);
    if (!waId) return;
    const contact = topLevelContactsByWaId.get(waId);
    const profile = contact && isRecord(contact.profile) ? contact.profile : null;
    output.push({
      waId,
      phone: waId,
      name:
        toTrimmed(message.name) ??
        (profile ? toTrimmed(profile.name) : null) ??
        (contact ? toTrimmed(contact.name) : null),
      messageBody:
        toTrimmed(message.messageBody) ??
        toTrimmed(message.message) ??
        toWebhookMessageText(message),
      messageAt: message.timestamp ?? message.messageAt ?? null,
      source: toTrimmed(message.source) ?? defaultSource ?? DEFAULT_SOURCE,
      campaignName: toTrimmed(message.campaignName) ?? defaultCampaignName,
      campaignId: toTrimmed(message.campaignId) ?? defaultCampaignId,
      leadLocation: toTrimmed(message.leadLocation) ?? defaultLocation,
      preferredLanguage: toTrimmed(message.preferredLanguage) ?? defaultLanguage,
      ownerUid: toTrimmed(message.ownerUid) ?? defaultOwnerUid,
      tags: uniqueText([
        ...defaultTags,
        ...normalizeTagList(message.tags),
        "Inbound Message",
      ]),
      targetDegree: toTrimmed(message.targetDegree),
      targetUniversity: toTrimmed(message.targetUniversity),
      currentEducation: toTrimmed(message.currentEducation),
      courseFees: toNumberOrNull(message.courseFees),
      note: toTrimmed(message.note),
      externalLeadId: toTrimmed(message.externalLeadId),
    });
  });

  const directEvents = Array.isArray(payload.events) ? payload.events : [];
  directEvents.forEach((event) => {
    if (!isRecord(event)) return;
    output.push({
      waId: toTrimmed(event.waId) ?? toTrimmed(event.phone) ?? null,
      phone: toTrimmed(event.phone),
      name: toTrimmed(event.name),
      email: toTrimmed(event.email),
      messageBody: toTrimmed(event.messageBody) ?? toTrimmed(event.message),
      messageAt: event.messageAt ?? event.timestamp ?? null,
      source: toTrimmed(event.source) ?? defaultSource ?? DEFAULT_SOURCE,
      campaignName: toTrimmed(event.campaignName) ?? defaultCampaignName,
      campaignId: toTrimmed(event.campaignId) ?? defaultCampaignId,
      leadLocation: toTrimmed(event.leadLocation) ?? defaultLocation,
      preferredLanguage: toTrimmed(event.preferredLanguage) ?? defaultLanguage,
      ownerUid: toTrimmed(event.ownerUid) ?? defaultOwnerUid,
      tags: uniqueText([...defaultTags, ...normalizeTagList(event.tags)]),
      targetDegree: toTrimmed(event.targetDegree),
      targetUniversity: toTrimmed(event.targetUniversity),
      currentEducation: toTrimmed(event.currentEducation),
      courseFees: toNumberOrNull(event.courseFees),
      note: toTrimmed(event.note),
      externalLeadId: toTrimmed(event.externalLeadId),
    });
  });

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  entries.forEach((entry) => {
    if (!isRecord(entry)) return;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    changes.forEach((change) => {
      if (!isRecord(change)) return;
      const value = isRecord(change.value) ? change.value : null;
      if (!value) return;

      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const contactByWaId = new Map<string, RecordValue>();
      contacts.forEach((contact) => {
        if (!isRecord(contact)) return;
        const waId = toTrimmed(contact.wa_id);
        if (!waId) return;
        contactByWaId.set(waId, contact);
      });

      const messages = Array.isArray(value.messages) ? value.messages : [];
      messages.forEach((message) => {
        if (!isRecord(message)) return;
        const waId = toTrimmed(message.from);
        if (!waId) return;
        const contact = contactByWaId.get(waId);
        const profile = contact && isRecord(contact.profile) ? contact.profile : null;
        const referral = isRecord(message.referral) ? message.referral : null;
        output.push({
          waId,
          phone: waId,
          name: profile ? toTrimmed(profile.name) : null,
          messageBody: toWebhookMessageText(message),
          messageAt: toTrimmed(message.timestamp),
          source: defaultSource ?? DEFAULT_SOURCE,
          campaignName:
            toTrimmed(referral?.headline) ??
            toTrimmed(referral?.source_url) ??
            defaultCampaignName,
          campaignId: toTrimmed(referral?.source_id) ?? defaultCampaignId,
          leadLocation: defaultLocation,
          preferredLanguage: defaultLanguage,
          ownerUid: defaultOwnerUid,
          tags: uniqueText([...defaultTags, "Inbound Message"]),
        });
      });

      if (messages.length === 0) {
        contacts.forEach((contact) => {
          if (!isRecord(contact)) return;
          const waId = toTrimmed(contact.wa_id);
          if (!waId) return;
          const profile = isRecord(contact.profile) ? contact.profile : null;
          output.push({
            waId,
            phone: waId,
            name: profile ? toTrimmed(profile.name) : null,
            source: defaultSource ?? DEFAULT_SOURCE,
            campaignName: defaultCampaignName,
            campaignId: defaultCampaignId,
            leadLocation: defaultLocation,
            preferredLanguage: defaultLanguage,
            ownerUid: defaultOwnerUid,
            tags: defaultTags,
          });
        });
      }
    });
  });

  return output;
}

export function extractWhatsappLeadInputsFromPull(payload: unknown) {
  if (!isRecord(payload)) return [] as WhatsappLeadInput[];

  const source = toTrimmed(payload.source) ?? DEFAULT_SOURCE;
  const campaignName = toTrimmed(payload.campaignName);
  const campaignId = toTrimmed(payload.campaignId);
  const ownerUid = toTrimmed(payload.ownerUid);
  const defaultTags = normalizeTagList(payload.tags);
  const defaultLocation = toOptionalTitleCase(payload.leadLocation);
  const defaultLanguage = toOptionalTitleCase(payload.preferredLanguage);

  const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
  return contacts
    .map((contact) => {
      if (!isRecord(contact)) return null;
      return {
        waId: toTrimmed(contact.waId) ?? toTrimmed(contact.phone),
        phone: toTrimmed(contact.phone),
        name: toTrimmed(contact.name),
        email: toTrimmed(contact.email),
        leadLocation: toTrimmed(contact.leadLocation) ?? defaultLocation,
        preferredLanguage: toTrimmed(contact.preferredLanguage) ?? defaultLanguage,
        campaignName: toTrimmed(contact.campaignName) ?? campaignName,
        campaignId: toTrimmed(contact.campaignId) ?? campaignId,
        source: toTrimmed(contact.source) ?? source,
        ownerUid: toTrimmed(contact.ownerUid) ?? ownerUid,
        tags: uniqueText([...defaultTags, ...normalizeTagList(contact.tags)]),
        note: toTrimmed(contact.note),
        messageBody: toTrimmed(contact.messageBody) ?? toTrimmed(contact.message),
        messageAt: contact.messageAt ?? contact.timestamp ?? null,
        targetDegree: toTrimmed(contact.targetDegree),
        targetUniversity: toTrimmed(contact.targetUniversity),
        currentEducation: toTrimmed(contact.currentEducation),
        courseFees: toNumberOrNull(contact.courseFees),
        externalLeadId: toTrimmed(contact.externalLeadId),
      } satisfies WhatsappLeadInput;
    })
    .filter(Boolean) as WhatsappLeadInput[];
}

export async function ingestWhatsappLeads(input: WhatsappIngestInput): Promise<WhatsappIngestResult> {
  const now = new Date();
  const todayKey = getTodayKey(now);
  const source = toTrimmed(input.source) ?? DEFAULT_SOURCE;
  const campaignName = toTrimmed(input.campaignName);
  const providedBatchId = normalizeBatchId(input.batchId);
  const batchId = providedBatchId ?? `wa-${Date.now().toString(36)}`;
  const globalTags = uniqueText([
    DEFAULT_IMPORT_TAG,
    ...normalizeTagList(input.tags),
    campaignName ? `Campaign: ${toTitleCase(campaignName)}` : null,
  ]);
  const globalTagsNormalized = globalTags.map((tag) => tag.toLowerCase());

  const configuredDefaultOwnerUid = toTrimmed(process.env.WHATSAPP_DEFAULT_OWNER_UID) ?? null;
  const fallbackOwnerUid = input.ownerUid?.trim() || configuredDefaultOwnerUid;
  const ownerCache = new Map<string, UserSummary | null>();

  const batchRef = input.adminDb.collection("crm_import_batches").doc(batchId);
  await batchRef.set(
    {
      ...buildImportBatchSeed(batchId),
      sourceTag: source,
      campaignName: campaignName ?? null,
      tags: globalTags,
      tagsNormalized: globalTagsNormalized,
      status: "processing",
      totalRows: input.leads.length,
      eligibleRows: input.leads.length,
      importedRows: 0,
      skippedRows: 0,
      duplicateFlaggedRows: 0,
      autoAssignedRows: 0,
      progressPercent: 0,
      requestId: toTrimmed(input.requestId) ?? null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      startedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const results: WhatsappIngestLeadResult[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  let duplicateCount = 0;
  let autoAssignedRows = 0;

  for (let index = 0; index < input.leads.length; index += 1) {
    const rawLead = input.leads[index];
    try {
      const normalized = normalizeWhatsappLead(rawLead, {
        source,
        campaignName,
        ownerUid: fallbackOwnerUid,
      });
      if (!normalized.phoneForLead || normalized.phoneCandidates.length === 0) {
        throw new Error("Missing phone/waId; cannot create a lead.");
      }

      const perLeadImportTags = uniqueText([
        ...globalTags,
        ...normalized.tags,
        normalized.campaignName ? `Campaign: ${toTitleCase(normalized.campaignName)}` : null,
      ]);
      const contextTags = buildContextTags({
        leadLocation: normalized.leadLocation,
        preferredLanguage: normalized.preferredLanguage,
      });
      const perLeadTags = uniqueText([...perLeadImportTags, ...contextTags]);

      const existing = await findExistingLead(input.adminDb, normalized);
      if (existing && isDuplicateMergeLead(existing.data)) {
        throw new Error("Matched lead is already merged and cannot be updated.");
      }

      const preferredOwnerUid = normalized.ownerUid ?? fallbackOwnerUid;
      const ownerSummary = preferredOwnerUid
        ? await getUserSummary(input.adminDb, preferredOwnerUid, ownerCache)
        : null;
      const ownerUid = ownerSummary?.uid ?? null;
      const ownerName = ownerSummary?.displayName ?? null;
      if (ownerUid) autoAssignedRows += 1;

      if (!existing) {
        const leadId = await createUniqueLeadId(input.adminDb);
        const transferReason = ownerUid
          ? "WhatsApp campaign lead auto-assigned on capture."
          : "WhatsApp campaign lead captured in shared pool.";
        const transferRecord = buildInitialTransferRecord({
          leadId,
          ownerUid,
          ownerName,
          reason: transferReason,
        });
        const historyEntry = buildHistoryEntry({
          action: "Lead Imported",
          oldStatus: null,
          newStatus: "new",
          remarks: normalized.note ?? "Lead captured from WhatsApp campaign.",
          timestamp: now,
        });
        const activityRows: Array<{ type: string; at: Date; note: string }> = [
          {
            type: "created",
            at: normalized.messageAt ?? now,
            note: normalized.note ?? "Lead captured from WhatsApp campaign.",
          },
        ];
        if (normalized.messageBody) {
          activityRows.push({
            type: "contacted",
            at: normalized.messageAt ?? now,
            note: `Inbound WhatsApp: ${normalized.messageBody}`,
          });
        }

        const leadPayload: Record<string, unknown> = {
          leadId,
          name: normalized.name,
          phone: normalized.phoneForLead,
          email: normalized.email,
          normalizedName: normalizeName(normalized.name),
          normalizedPhone: normalizePhoneDigits(normalized.phoneForLead),
          normalizedEmail: normalizeEmail(normalized.email),
          currentEducation: normalized.currentEducation,
          targetDegree: normalized.targetDegree,
          targetUniversity: normalized.targetUniversity,
          leadLocation: normalized.leadLocation,
          preferredLanguage: normalized.preferredLanguage,
          courseFees: normalized.courseFees,
          remarks: normalized.note,
          status: "new",
          assignedTo: ownerUid,
          ownerUid,
          assignedBy: ownerUid ? INTEGRATION_UID : null,
          assignedAt: ownerUid ? FieldValue.serverTimestamp() : null,
          source: normalized.source,
          sourceNormalized: normalized.source.toLowerCase(),
          campaignName: normalized.campaignName ?? null,
          importBatchId: batchId,
          importTags: perLeadImportTags,
          importTagsNormalized: perLeadImportTags.map((tag) => tag.toLowerCase()),
          importFileName: "whatsapp-mock",
          importedAt: FieldValue.serverTimestamp(),
          importedBy: INTEGRATION_ACTOR,
          leadTags: perLeadTags,
          leadTagsNormalized: perLeadTags.map((tag) => tag.toLowerCase()),
          activityHistory: activityRows,
          history: [historyEntry],
          kycData: {
            aadhar: null,
            pan: null,
            address: null,
            parentDetails: null,
          },
          duplicateFlag: false,
          duplicateReasons: null,
          duplicateCandidateLeadIds: null,
          duplicateScore: null,
          duplicateDetectedAt: null,
          duplicateDetectionSource: null,
          custodyState: ownerUid ? "owned" : "pooled",
          custodyReason: transferReason,
          custodyUpdatedAt: FieldValue.serverTimestamp(),
          lastTransfer: transferRecord,
          transferHistory: [transferRecord],
          createdDateKey: todayKey,
          lastContactDateKey: todayKey,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastActionBy: INTEGRATION_UID,
          lastActionAt: FieldValue.serverTimestamp(),
          whatsappMeta: {
            waId: normalized.waId,
            campaignId: normalized.campaignId,
            campaignName: normalized.campaignName,
            externalLeadId: normalized.externalLeadId,
            messageBody: normalized.messageBody,
            lastInboundAt: normalized.messageAt ?? now,
            source: normalized.source,
            syncedAt: FieldValue.serverTimestamp(),
          },
        };

        const leadRef = input.adminDb.collection("leads").doc(leadId);
        await leadRef.set(leadPayload, { merge: true });
        await leadRef.collection("timeline").add({
          type: "created",
          summary: ownerUid
            ? `WhatsApp lead captured and assigned to ${ownerName ?? ownerUid}.`
            : "WhatsApp lead captured in shared pool.",
          actor: INTEGRATION_ACTOR,
          metadata: {
            source: "whatsapp_mock",
            sourceLabel: normalized.source,
            campaignName: normalized.campaignName ?? null,
            campaignId: normalized.campaignId ?? null,
            waId: normalized.waId,
            externalLeadId: normalized.externalLeadId,
            importBatchId: batchId,
            importTags: perLeadImportTags,
            leadTags: perLeadTags,
            ownerUid,
            ownerName,
          },
          createdAt: FieldValue.serverTimestamp(),
        });

        if (ownerUid) {
          await input.adminDb.collection("notifications").add({
            recipientUid: ownerUid,
            title: "New WhatsApp lead assigned",
            body: `${normalized.name} was auto-added from WhatsApp campaign.`,
            read: false,
            priority: "medium",
            source: "whatsapp_integration",
            relatedLeadId: leadId,
            createdAt: FieldValue.serverTimestamp(),
          });
        }

        createdCount += 1;
        results.push({
          index,
          status: "created",
          leadId,
          name: normalized.name,
          phone: normalized.phoneForLead,
          waId: normalized.waId,
        });
      } else {
        const existingImportTags = toStringArray(existing.data.importTags);
        const existingLeadTags = toStringArray(existing.data.leadTags);
        const mergedImportTags = uniqueText([...existingImportTags, ...perLeadImportTags]);
        const mergedLeadTags = uniqueText([...existingLeadTags, ...perLeadTags]);
        const sourceToPersist = toTrimmed(existing.data.source) ?? normalized.source;
        const existingWhatsappMeta = isRecord((existing.data as RecordValue).whatsappMeta)
          ? ((existing.data as RecordValue).whatsappMeta as RecordValue)
          : {};
        const updateHistoryEntry = buildHistoryEntry({
          action: "WhatsApp Sync Update",
          oldStatus: String(existing.data.status ?? "new"),
          newStatus: String(existing.data.status ?? "new"),
          remarks: normalized.note ?? "WhatsApp campaign re-sync",
          timestamp: now,
        });
        const activityEntry = {
          type: "contacted",
          at: normalized.messageAt ?? now,
          note: normalized.messageBody
            ? `Inbound WhatsApp: ${normalized.messageBody}`
            : "WhatsApp profile/contact synced.",
        };

        const patch: Record<string, unknown> = {
          updatedAt: FieldValue.serverTimestamp(),
          lastActionBy: INTEGRATION_UID,
          lastActionAt: FieldValue.serverTimestamp(),
          lastContactDateKey: todayKey,
          source: sourceToPersist,
          sourceNormalized: sourceToPersist.toLowerCase(),
          campaignName: normalized.campaignName ?? existing.data.campaignName ?? null,
          importBatchId: batchId,
          importTags: mergedImportTags,
          importTagsNormalized: mergedImportTags.map((tag) => tag.toLowerCase()),
          leadTags: mergedLeadTags,
          leadTagsNormalized: mergedLeadTags.map((tag) => tag.toLowerCase()),
          importedBy: INTEGRATION_ACTOR,
          importedAt: FieldValue.serverTimestamp(),
          remarks: existing.data.remarks ?? normalized.note ?? null,
          history: FieldValue.arrayUnion(updateHistoryEntry),
          activityHistory: FieldValue.arrayUnion(activityEntry),
          whatsappMeta: {
            ...existingWhatsappMeta,
            waId: normalized.waId ?? toTrimmed(existingWhatsappMeta.waId) ?? null,
            campaignId: normalized.campaignId ?? toTrimmed(existingWhatsappMeta.campaignId) ?? null,
            campaignName: normalized.campaignName ?? toTrimmed(existingWhatsappMeta.campaignName) ?? null,
            externalLeadId:
              normalized.externalLeadId ?? toTrimmed(existingWhatsappMeta.externalLeadId) ?? null,
            messageBody:
              normalized.messageBody ?? toTrimmed(existingWhatsappMeta.messageBody) ?? null,
            lastInboundAt: normalized.messageAt ?? now,
            source: sourceToPersist,
            syncedAt: FieldValue.serverTimestamp(),
          },
        };

        if (shouldReplaceLeadName(existing.data.name) && normalized.name) {
          patch.name = normalized.name;
          patch.normalizedName = normalizeName(normalized.name);
        }

        if (!toTrimmed(existing.data.phone) && normalized.phoneForLead) {
          patch.phone = normalized.phoneForLead;
          patch.normalizedPhone = normalizePhoneDigits(normalized.phoneForLead);
        }

        if (!toTrimmed(existing.data.email) && normalized.email) {
          patch.email = normalized.email;
          patch.normalizedEmail = normalizeEmail(normalized.email);
        }

        if (!toTrimmed(existing.data.leadLocation) && normalized.leadLocation) {
          patch.leadLocation = normalized.leadLocation;
        }

        if (!toTrimmed(existing.data.preferredLanguage) && normalized.preferredLanguage) {
          patch.preferredLanguage = normalized.preferredLanguage;
        }

        if (!toTrimmed(existing.data.targetDegree) && normalized.targetDegree) {
          patch.targetDegree = normalized.targetDegree;
        }

        if (!toTrimmed(existing.data.targetUniversity) && normalized.targetUniversity) {
          patch.targetUniversity = normalized.targetUniversity;
        }

        if (!toTrimmed(existing.data.currentEducation) && normalized.currentEducation) {
          patch.currentEducation = normalized.currentEducation;
        }

        if (
          (existing.data.courseFees == null || Number(existing.data.courseFees) <= 0) &&
          normalized.courseFees != null
        ) {
          patch.courseFees = normalized.courseFees;
        }

        const leadRef = input.adminDb.collection("leads").doc(existing.id);
        await leadRef.set(patch, { merge: true });
        await leadRef.collection("timeline").add({
          type: "activity_logged",
          summary: "WhatsApp contact synced to existing lead.",
          actor: INTEGRATION_ACTOR,
          metadata: {
            source: "whatsapp_mock",
            sourceLabel: sourceToPersist,
            campaignName: normalized.campaignName ?? null,
            campaignId: normalized.campaignId ?? null,
            waId: normalized.waId,
            externalLeadId: normalized.externalLeadId,
            importBatchId: batchId,
            updatedFields: Object.keys(patch),
          },
          createdAt: FieldValue.serverTimestamp(),
        });

        updatedCount += 1;
        duplicateCount += 1;
        results.push({
          index,
          status: "updated",
          leadId: existing.id,
          name: normalized.name,
          phone: normalized.phoneForLead,
          waId: normalized.waId,
        });
      }

      const progressPercent = input.leads.length > 0
        ? Math.round(((createdCount + updatedCount + failedCount) / input.leads.length) * 100)
        : 100;
      await batchRef.set(
        {
          importedRows: createdCount + updatedCount,
          duplicateFlaggedRows: duplicateCount,
          autoAssignedRows,
          failedRows: failedCount,
          progressPercent,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      failedCount += 1;
      results.push({
        index,
        status: "failed",
        name: toTrimmed(rawLead.name) ?? null,
        phone: toTrimmed(rawLead.phone) ?? toTrimmed(rawLead.waId) ?? null,
        waId: toTrimmed(rawLead.waId) ?? null,
        reason: error instanceof Error ? error.message : "Unknown ingest failure",
      });
    }
  }

  const success = failedCount === 0;
  await batchRef.set(
    {
      status: success ? "completed" : "failed",
      importedRows: createdCount + updatedCount,
      duplicateFlaggedRows: duplicateCount,
      autoAssignedRows,
      failedRows: failedCount,
      progressPercent: 100,
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const ingestSummary = {
    success,
    batchId,
    source,
    campaignName: campaignName ?? null,
    totalReceived: input.leads.length,
    createdCount,
    updatedCount,
    failedCount,
    results,
  } satisfies WhatsappIngestResult;

  await input.adminDb.collection("crm_whatsapp_ingest_events").add({
    source: "whatsapp_mock",
    requestId: toTrimmed(input.requestId) ?? null,
    batchId,
    campaignName: campaignName ?? null,
    totals: {
      received: input.leads.length,
      created: createdCount,
      updated: updatedCount,
      failed: failedCount,
    },
    resultPreview: results.slice(0, 100),
    rawPayload: input.rawPayload ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  try {
    await writeServerAudit(input.adminDb, {
      action: "CRM_WHATSAPP_INGEST",
      details: `WhatsApp mock ingest processed ${input.leads.length} lead(s).`,
      actor: {
        uid: INTEGRATION_UID,
        name: "WhatsApp Integration",
        role: "SYSTEM",
      },
      metadata: {
        batchId,
        source,
        campaignName: campaignName ?? null,
        createdCount,
        updatedCount,
        failedCount,
      },
    });
  } catch (auditError) {
    console.error("Unable to write WhatsApp ingest audit log:", auditError);
  }

  return ingestSummary;
}
