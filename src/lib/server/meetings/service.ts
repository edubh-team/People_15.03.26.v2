import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  isAdminUser,
  isHrUser,
  isManagerUser,
  isTeamLeadUser,
} from "@/lib/access";
import { getHierarchyScopedUsers } from "@/lib/sales/hierarchy";
import { buildServerActor, writeServerAudit } from "@/lib/server/audit-log";
import type {
  AttendanceDoc,
  CancelMeetingInput,
  CreateMeetingInput,
  MeetingAudienceResponse,
  MeetingDoc,
  MeetingParticipantOption,
  MeetingUserSnapshot,
  MeetingViewModel,
  ParticipantDoc,
  RecordingDoc,
  UpdateMeetingInput,
  ZohoMeetingConnectionDoc,
} from "@/lib/types/meetings";
import type { UserDoc } from "@/lib/types/user";
import {
  ZohoMeetingError,
  buildZohoConnectionDocument,
  createZohoMeeting,
  deleteZohoMeeting,
  exchangeZohoAuthorizationCode,
  fetchZohoCurrentUser,
  fetchZohoParticipantReport,
  getZohoRecordingsForMeeting,
  listZohoRecordings,
  mapZohoRecordingStatus,
  readZohoEpochMs,
  readZohoFileSizeBytes,
  refreshZohoAccessToken,
  revokeZohoToken,
  updateZohoMeeting,
} from "@/lib/server/meetings/zoho";

const MEETINGS_COLLECTION = "meetings";
const PARTICIPANTS_COLLECTION = "participants";
const ATTENDANCE_COLLECTION = "attendance";
const RECORDINGS_COLLECTION = "recordings";
const CONNECTIONS_COLLECTION = "zoho_meeting_connections";
const CONNECTION_REFRESH_WINDOW_MS = 1000 * 60 * 5;
const DEFAULT_TIMEZONE = "Asia/Calcutta";
const LIST_LIMIT = 120;
const ZOHO_MEETING_MAX_PARTICIPANTS = 100;

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => typeof entry !== "undefined") as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => typeof entryValue !== "undefined")
        .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)]),
    ) as T;
  }

  return value;
}

function nowMeetingStatus(meeting: Pick<MeetingDoc, "status" | "startTimeMs" | "endTimeMs">) {
  if (meeting.status === "cancelled") return "cancelled" as const;
  if (meeting.status === "sync_error") return "sync_error" as const;
  const now = Date.now();
  if (meeting.endTimeMs <= now) return "completed" as const;
  if (meeting.startTimeMs <= now && meeting.endTimeMs > now) return "live" as const;
  return "scheduled" as const;
}

function normalizeDepartmentName(value: string | null | undefined) {
  return value?.trim() || "";
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

function readAdditionalInviteEmails(values: Array<string | null | undefined> | undefined) {
  return uniqueStrings(values ?? []).map((value) => normalizeEmail(value)).filter(Boolean);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function participantDocId(meetingId: string, email: string, uid?: string | null) {
  if (uid?.trim()) return `${meetingId}__${uid.trim()}`;
  return `${meetingId}__${normalizeEmail(email).replace(/[^a-z0-9]+/g, "_")}`;
}

function attendanceDocId(meetingId: string, email: string | null, memberId: string | null) {
  const tail = memberId?.trim() || email?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") || "unknown";
  return `${meetingId}__${tail}`;
}

function toMeetingUserSnapshot(user: UserDoc): MeetingUserSnapshot {
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? user.name ?? user.email ?? user.uid,
    role: user.role ?? null,
    orgRole: user.orgRole ?? null,
    department: user.department ?? null,
    employeeId: user.employeeId ?? null,
  };
}

function ensureMeetingCreatePermission(user: UserDoc) {
  if (isAdminUser(user) || isHrUser(user) || isManagerUser(user) || isTeamLeadUser(user)) {
    return;
  }
  throw new ZohoMeetingError("Forbidden: you do not have permission to create meetings.", 403);
}

function isUserManagerOrAbove(user: UserDoc) {
  return isAdminUser(user) || isHrUser(user) || isManagerUser(user) || isTeamLeadUser(user);
}

async function readAllUsers(adminDb: Firestore) {
  const snapshot = await adminDb.collection("users").get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as UserDoc), uid: doc.id } as UserDoc));
}

function isActiveUser(user: UserDoc) {
  return (user.status ?? "").toLowerCase() !== "terminated" && user.isActive !== false;
}

function sortParticipantOptions(values: MeetingParticipantOption[]) {
  return [...values].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function parseZohoPortalName(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as { brand_name?: string; source?: string };
    return parsed.brand_name?.trim() || parsed.source?.trim() || value;
  } catch {
    return value;
  }
}

async function getScopedDirectory(adminDb: Firestore, actor: UserDoc) {
  const allUsers = await readAllUsers(adminDb);
  const activeUsers = allUsers.filter(isActiveUser);

  if (isAdminUser(actor) || isHrUser(actor)) {
    return activeUsers;
  }

  if (isManagerUser(actor) || isTeamLeadUser(actor)) {
    return getHierarchyScopedUsers(actor, activeUsers, {
      includeCurrentUser: true,
    });
  }

  return activeUsers.filter((user) => user.uid === actor.uid);
}

export async function getMeetingAudienceDirectory(
  adminDb: Firestore,
  actor: UserDoc,
): Promise<MeetingAudienceResponse> {
  const scopedUsers = await getScopedDirectory(adminDb, actor);
  const connectionSnap = await adminDb.collection(CONNECTIONS_COLLECTION).doc(actor.uid).get();
  const connection = connectionSnap.exists
    ? ({ ...(connectionSnap.data() as ZohoMeetingConnectionDoc), uid: connectionSnap.id })
    : null;

  const participants = sortParticipantOptions(
    scopedUsers.map((user) => ({
      uid: user.uid,
      email: user.email ?? null,
      displayName:
        user.displayName?.trim() || user.name?.trim() || user.email?.trim() || user.uid,
      role: user.role ?? null,
      orgRole: user.orgRole ?? null,
      department: user.department ?? null,
      employeeId: user.employeeId ?? null,
    })),
  );

  return {
    success: true,
    zohoConnected: Boolean(connection),
    connectionOwnerUid: connection ? actor.uid : null,
    zohoConnection: connection
      ? {
          uid: connection.uid,
          primaryEmail: connection.primaryEmail,
          ownerDisplayName: connection.owner.displayName ?? null,
          portalName: parseZohoPortalName(connection.portalName),
        }
      : null,
    availableDepartments: uniqueStrings(
      participants.map((participant) => participant.department),
    ).sort((left, right) => left.localeCompare(right)),
    participants,
    defaults: {
      timezone: DEFAULT_TIMEZONE,
    },
  };
}

export async function disconnectZohoMeetingConnection(
  adminDb: Firestore,
  actor: UserDoc,
) {
  const connectionRef = adminDb.collection(CONNECTIONS_COLLECTION).doc(actor.uid);
  const connectionSnap = await connectionRef.get();
  if (!connectionSnap.exists) {
    return { disconnected: false };
  }

  const connection = {
    ...(connectionSnap.data() as ZohoMeetingConnectionDoc),
    uid: connectionSnap.id,
  };

  let revoked = false;
  try {
    const tokenToRevoke = connection.refreshToken?.trim() || connection.accessToken?.trim() || "";
    if (tokenToRevoke) {
      await revokeZohoToken(tokenToRevoke);
      revoked = true;
    }
  } catch {
    revoked = false;
  }

  await connectionRef.delete();

  await writeServerAudit(adminDb, {
    action: "ZOHO_MEETING_DISCONNECTED",
    details: `${actor.displayName ?? actor.email ?? actor.uid} disconnected Zoho Meeting.`,
    actor: buildServerActor(actor),
    metadata: {
      integration: "zoho_meeting",
      organizationId: connection.organizationId,
      zuid: connection.zuid,
      primaryEmail: connection.primaryEmail,
      revoked,
    },
  });

  return {
    disconnected: true,
    revoked,
  };
}

async function resolveAudienceParticipants(
  adminDb: Firestore,
  actor: UserDoc,
  input: CreateMeetingInput["audience"],
) {
  const scopedUsers = await getScopedDirectory(adminDb, actor);
  const allowedUsers = new Map(scopedUsers.map((user) => [user.uid, user]));

  let selectedUsers: UserDoc[] = [];
  let scopeSummary = "";

  if (input.mode === "team") {
    const excludedUids = uniqueStrings(input.excludedParticipantUids ?? []);
    selectedUsers = scopedUsers.filter(
      (user) => user.uid !== actor.uid && !excludedUids.includes(user.uid),
    );
    scopeSummary = excludedUids.length > 0
      ? `Entire Team (${excludedUids.length} excluded)`
      : "Entire Team";
  } else if (input.mode === "department") {
    const departments = uniqueStrings(input.departmentNames ?? []);
    selectedUsers = scopedUsers.filter((user) =>
      departments.includes(normalizeDepartmentName(user.department)),
    );
    scopeSummary = departments.length > 0 ? `Department: ${departments.join(", ")}` : "Department";
  } else {
    const requestedUids = uniqueStrings(input.participantUids ?? []);
    selectedUsers = requestedUids
      .map((uid) => allowedUsers.get(uid) ?? null)
      .filter((user): user is UserDoc => Boolean(user));
    scopeSummary = "Individual Employees";
  }

  const emailBackedUsers = selectedUsers.filter((user) => user.email?.trim());
  if (emailBackedUsers.length === 0) {
    throw new ZohoMeetingError(
      "Select at least one participant with a valid email address.",
      400,
    );
  }

  return {
    scopedUsers,
    selectedUsers: emailBackedUsers,
    audience: {
      mode: input.mode,
      departmentNames: uniqueStrings(input.departmentNames ?? []),
      participantUids: emailBackedUsers.map((user) => user.uid),
      excludedParticipantUids:
        input.mode === "team" ? uniqueStrings(input.excludedParticipantUids ?? []) : [],
      scopeSummary,
    },
  };
}

function ensurePositiveInteger(value: unknown, fieldName: string) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ZohoMeetingError(`${fieldName} must be a positive number.`, 400);
  }
  return parsed;
}

function validateMeetingInput(input: CreateMeetingInput) {
  if (!input.title?.trim()) {
    throw new ZohoMeetingError("Meeting title is required.", 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new ZohoMeetingError("Meeting date is invalid.", 400);
  }
  if (!/^\d{2}:\d{2}$/.test(input.time)) {
    throw new ZohoMeetingError("Meeting time is invalid.", 400);
  }
  if (!input.timezone?.trim()) {
    throw new ZohoMeetingError("Meeting timezone is required.", 400);
  }

  const durationMinutes = ensurePositiveInteger(input.durationMinutes, "Duration");
  const startTimeMs = ensurePositiveInteger(input.startTimeMs, "Start time");
  if (startTimeMs <= Date.now() - 1000 * 60 * 15) {
    throw new ZohoMeetingError("Meetings cannot be scheduled in the past.", 400);
  }

  return {
    ...input,
    title: input.title.trim(),
    agenda: input.agenda?.trim() || null,
    timezone: input.timezone.trim(),
    durationMinutes,
    startTimeMs,
    additionalInviteEmails: readAdditionalInviteEmails(input.additionalInviteEmails),
  };
}

async function readConnection(
  adminDb: Firestore,
  uid: string,
): Promise<ZohoMeetingConnectionDoc> {
  const snapshot = await adminDb.collection(CONNECTIONS_COLLECTION).doc(uid).get();
  if (!snapshot.exists) {
    throw new ZohoMeetingError(
      "Zoho Meeting is not connected for this account. Connect Zoho before scheduling meetings.",
      409,
    );
  }
  return { ...(snapshot.data() as ZohoMeetingConnectionDoc), uid: snapshot.id };
}

export async function syncZohoMeetingConnectionFromCode(
  adminDb: Firestore,
  actor: UserDoc,
  code: string,
  redirectUri?: string,
) {
  let token;
  let currentUser;
  try {
    if (process.env.NODE_ENV !== "production") {
      console.log("[DEBUG] syncZohoMeetingConnectionFromCode: exchanging code", { actor: actor.uid });
    }
    token = await exchangeZohoAuthorizationCode(code, redirectUri);
    if (process.env.NODE_ENV !== "production") {
      console.log("[DEBUG] syncZohoMeetingConnectionFromCode: token received", {
        hasAccessToken: Boolean(token?.access_token),
        hasRefreshToken: Boolean(token?.refresh_token),
      });
    }
    currentUser = await fetchZohoCurrentUser(token.access_token);
    if (process.env.NODE_ENV !== "production") {
      console.log("[DEBUG] syncZohoMeetingConnectionFromCode: current user", {
        organizationId: currentUser.organizationId,
        zuid: currentUser.zuid,
        primaryEmail: currentUser.primaryEmail,
      });
    }
  } catch (err) {
    console.error("[ZOHO_CONNECTION_EXCHANGE_ERROR]", {
      actorUid: actor.uid,
      redirectUri: redirectUri ?? null,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      payload: (err as any)?.payload ?? null,
    });
    throw err;
  }

  const baseDoc = buildZohoConnectionDocument({
    uid: actor.uid,
    owner: toMeetingUserSnapshot(actor),
    token,
    currentUser,
  });

  await adminDb.collection(CONNECTIONS_COLLECTION).doc(actor.uid).set(
    stripUndefinedDeep({
      ...baseDoc,
      connectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastRefreshAt: FieldValue.serverTimestamp(),
      lastError: null,
    }),
    { merge: true },
  );

  await writeServerAudit(adminDb, {
    action: "ZOHO_MEETING_CONNECTED",
    details: `${actor.displayName ?? actor.email ?? actor.uid} connected Zoho Meeting.`,
    actor: buildServerActor(actor),
    metadata: {
      integration: "zoho_meeting",
      organizationId: currentUser.organizationId,
      zuid: currentUser.zuid,
    },
  });
}

export async function ensureFreshZohoConnection(
  adminDb: Firestore,
  uid: string,
) {
  const existing = await readConnection(adminDb, uid);
  if (existing.expiresAtMs > Date.now() + CONNECTION_REFRESH_WINDOW_MS) {
    return existing;
  }

  if (!existing.refreshToken?.trim()) {
    throw new ZohoMeetingError(
      "Zoho Meeting refresh token is missing. Reconnect Zoho to continue.",
      409,
    );
  }

  try {
    const refreshed = await refreshZohoAccessToken(existing.refreshToken);
    const next: ZohoMeetingConnectionDoc = {
      ...existing,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || existing.refreshToken,
      tokenType: refreshed.token_type || existing.tokenType,
      expiresAtMs:
        Date.now() +
        (typeof refreshed.expires_in === "number"
          ? refreshed.expires_in
          : (refreshed.expires_in_sec ?? 3600) * 1000),
    };
    await adminDb.collection(CONNECTIONS_COLLECTION).doc(uid).set(
      {
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        tokenType: next.tokenType,
        expiresAtMs: next.expiresAtMs,
        updatedAt: FieldValue.serverTimestamp(),
        lastRefreshAt: FieldValue.serverTimestamp(),
        lastError: null,
      },
      { merge: true },
    );
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to refresh Zoho token.";
    await adminDb.collection(CONNECTIONS_COLLECTION).doc(uid).set(
      {
        lastError: message,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    throw error;
  }
}

function buildMeetingStatusSnapshot(input: {
  validated: CreateMeetingInput;
  actor: UserDoc;
  selectedUsers: UserDoc[];
  additionalInviteEmails: string[];
  audience: MeetingDoc["audience"];
  participantEmails: string[];
  zoho: {
    meetingKey: string;
    joinUrl: string;
    startUrl: string;
    passwordMasked?: string | null;
    encryptedPasswordMasked?: string | null;
    embedUrl?: string | null;
    connectionUid: string;
    organizationId: string;
    presenterZuid: string;
  };
  existingMeetingId?: string;
}) {
  const host = toMeetingUserSnapshot(input.actor);

  return {
    id: input.existingMeetingId ?? "",
    title: input.validated.title,
    agenda: input.validated.agenda ?? null,
    date: input.validated.date,
    time: input.validated.time,
    timezone: input.validated.timezone,
    startTimeLabel: `${input.validated.date} ${input.validated.time}`,
    startTimeMs: input.validated.startTimeMs,
    endTimeMs: input.validated.startTimeMs + input.validated.durationMinutes * 60 * 1000,
    durationMinutes: input.validated.durationMinutes,
    status: "scheduled" as const,
    audience: input.audience,
    participantCount: input.participantEmails.length,
    participantUserUids: input.selectedUsers.map((user) => user.uid),
    participantEmails: input.participantEmails,
    externalParticipantEmails: input.additionalInviteEmails,
    host,
    zoho: {
      connectionUid: input.zoho.connectionUid,
      organizationId: input.zoho.organizationId,
      presenterZuid: input.zoho.presenterZuid,
      zohoMeetingId: input.zoho.meetingKey,
      meetingKey: input.zoho.meetingKey,
      joinUrl: input.zoho.joinUrl,
      startUrl: input.zoho.startUrl,
      passwordMasked: input.zoho.passwordMasked ?? null,
      encryptedPasswordMasked: input.zoho.encryptedPasswordMasked ?? null,
      embedUrl: input.zoho.embedUrl ?? null,
    },
    attendanceSummary: {
      invited: input.participantEmails.length,
      attended: 0,
      missed: 0,
      totalDurationMs: 0,
    },
    recordingSummary: {
      count: 0,
    },
  };
}

async function upsertParticipantRows(
  adminDb: Firestore,
  meetingId: string,
  meetingTitle: string,
  meetingStartTimeMs: number,
  audience: MeetingDoc["audience"],
  selectedUsers: UserDoc[],
  additionalInviteEmails: string[],
) {
  const existingSnapshot = await adminDb
    .collection(PARTICIPANTS_COLLECTION)
    .where("meetingId", "==", meetingId)
    .get();

  const nextRows = new Map<string, ParticipantDoc>();
  selectedUsers.forEach((user) => {
    if (!user.email?.trim()) return;
    const displayName =
      user.displayName?.trim() || user.name?.trim() || user.email.trim() || user.uid;
    const rowId = participantDocId(meetingId, user.email, user.uid);
    nextRows.set(rowId, {
      id: rowId,
      meetingId,
      meetingTitle,
      meetingStartTimeMs,
      participantUid: user.uid,
      email: user.email.trim().toLowerCase(),
      displayName,
      role: user.role ?? null,
      orgRole: user.orgRole ?? null,
      department: user.department ?? null,
      employeeId: user.employeeId ?? null,
      audienceMode: audience.mode,
      audienceSourceLabel: audience.scopeSummary,
      status: "invited",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  additionalInviteEmails.forEach((email) => {
    const rowId = participantDocId(meetingId, email, null);
    nextRows.set(rowId, {
      id: rowId,
      meetingId,
      meetingTitle,
      meetingStartTimeMs,
      participantUid: null,
      email,
      displayName: email,
      role: null,
      orgRole: null,
      department: null,
      employeeId: null,
      audienceMode: audience.mode,
      audienceSourceLabel: "External Invite",
      status: "invited",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const batch = adminDb.batch();
  existingSnapshot.docs.forEach((doc) => {
    if (nextRows.has(doc.id)) return;
    batch.set(
      doc.ref,
      {
        status: "removed",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  nextRows.forEach((row, rowId) => {
    batch.set(
      adminDb.collection(PARTICIPANTS_COLLECTION).doc(rowId),
      stripUndefinedDeep(row),
      { merge: true },
    );
  });

  await batch.commit();
}

async function readMeeting(adminDb: Firestore, meetingId: string) {
  const snapshot = await adminDb.collection(MEETINGS_COLLECTION).doc(meetingId).get();
  if (!snapshot.exists) {
    throw new ZohoMeetingError("Meeting not found.", 404);
  }
  return { ...(snapshot.data() as MeetingDoc), id: snapshot.id };
}

function canUserViewMeeting(
  actor: UserDoc,
  meeting: MeetingDoc,
  scopedUids: Set<string>,
) {
  if (isAdminUser(actor) || isHrUser(actor)) return true;
  if (meeting.createdBy.uid === actor.uid || meeting.host.uid === actor.uid) return true;
  if (meeting.participantUserUids.includes(actor.uid)) return true;
  if (actor.email?.trim() && meeting.participantEmails.includes(actor.email.trim().toLowerCase())) {
    return true;
  }
  if (isManagerUser(actor) || isTeamLeadUser(actor)) {
    if (scopedUids.has(meeting.createdBy.uid) || scopedUids.has(meeting.host.uid)) return true;
    return meeting.participantUserUids.some((uid) => scopedUids.has(uid));
  }
  return false;
}

function canUserEditMeeting(actor: UserDoc, meeting: MeetingDoc) {
  if (meeting.status === "cancelled") return false;
  if (isAdminUser(actor) || isHrUser(actor)) return true;
  return isUserManagerOrAbove(actor) && (meeting.createdBy.uid === actor.uid || meeting.host.uid === actor.uid);
}

function buildActionAccess(actor: UserDoc, meeting: MeetingDoc) {
  const canEdit = canUserEditMeeting(actor, meeting);
  const canStart =
    Boolean(meeting.zoho.startUrl) &&
    (isAdminUser(actor) ||
      isHrUser(actor) ||
      actor.uid === meeting.createdBy.uid ||
      actor.uid === meeting.host.uid);
  const canJoin =
    Boolean(meeting.zoho.joinUrl) &&
    (canStart ||
      meeting.participantUserUids.includes(actor.uid) ||
      (actor.email?.trim()
        ? meeting.participantEmails.includes(actor.email.trim().toLowerCase())
        : false));
  return {
    canEdit,
    canCancel: canEdit,
    canStart,
    canJoin,
  };
}

async function readParticipantsByMeetingIds(adminDb: Firestore, meetingIds: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < meetingIds.length; index += 10) {
    chunks.push(meetingIds.slice(index, index + 10));
  }

  const result = new Map<string, ParticipantDoc[]>();
  await Promise.all(
    chunks.map(async (chunk) => {
      const snapshot = await adminDb
        .collection(PARTICIPANTS_COLLECTION)
        .where("meetingId", "in", chunk)
        .get();
      snapshot.docs.forEach((doc) => {
        const row = { ...(doc.data() as ParticipantDoc), id: doc.id };
        const bucket = result.get(row.meetingId) ?? [];
        bucket.push(row);
        result.set(row.meetingId, bucket);
      });
    }),
  );
  return result;
}

async function toMeetingViewModels(
  adminDb: Firestore,
  actor: UserDoc,
  meetings: MeetingDoc[],
) {
  const scopedDirectory = await getScopedDirectory(adminDb, actor);
  const scopedUids = new Set(scopedDirectory.map((user) => user.uid));
  const participantsByMeetingId = await readParticipantsByMeetingIds(
    adminDb,
    meetings.map((meeting) => meeting.id),
  );

  return meetings.map((meeting) => ({
    ...meeting,
    status: nowMeetingStatus(meeting),
    participantRows: (participantsByMeetingId.get(meeting.id) ?? []).sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    ),
    actionAccess: buildActionAccess(actor, meeting),
  }));
}

async function queryMeetingsForMode(
  adminDb: Firestore,
  mode: "upcoming" | "history",
) {
  const now = Date.now();
  if (mode === "upcoming") {
    const snapshot = await adminDb
      .collection(MEETINGS_COLLECTION)
      .where("startTimeMs", ">=", now - 1000 * 60 * 60 * 24)
      .orderBy("startTimeMs", "asc")
      .limit(LIST_LIMIT)
      .get();
    return snapshot.docs.map((doc) => ({ ...(doc.data() as MeetingDoc), id: doc.id }));
  }

  const snapshot = await adminDb
    .collection(MEETINGS_COLLECTION)
    .where("startTimeMs", "<", now + 1000 * 60 * 60 * 12)
    .orderBy("startTimeMs", "desc")
    .limit(LIST_LIMIT)
    .get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as MeetingDoc), id: doc.id }));
}

export async function createMeeting(adminDb: Firestore, actor: UserDoc, payload: CreateMeetingInput) {
  ensureMeetingCreatePermission(actor);
  const validated = validateMeetingInput(payload);
  const { selectedUsers, audience } = await resolveAudienceParticipants(adminDb, actor, payload.audience);
  const additionalInviteEmails = validated.additionalInviteEmails ?? [];
  const invalidInviteEmail = additionalInviteEmails.find((email) => !isValidEmail(email));
  if (invalidInviteEmail) {
    throw new ZohoMeetingError(`Invalid additional invite email: ${invalidInviteEmail}`, 400);
  }
  const participantEmails = uniqueStrings([
    ...selectedUsers.map((user) => normalizeEmail(user.email)),
    ...additionalInviteEmails,
  ]);
  if (participantEmails.length === 0) {
    throw new ZohoMeetingError(
      "Add at least one valid CRM participant or additional invite email.",
      400,
    );
  }
  if (participantEmails.length > ZOHO_MEETING_MAX_PARTICIPANTS) {
    throw new ZohoMeetingError(
      `Zoho Meeting supports up to ${ZOHO_MEETING_MAX_PARTICIPANTS} invitees per meeting. You selected ${participantEmails.length}. Choose a smaller audience or remove some external emails.`,
      400,
      {
        limit: ZOHO_MEETING_MAX_PARTICIPANTS,
        count: participantEmails.length,
        parameter: "participants",
      },
    );
  }
  const connection = await ensureFreshZohoConnection(adminDb, actor.uid);
  const zohoResponse = await createZohoMeeting(connection, {
    ...validated,
    participantEmails,
  });
  const session = zohoResponse.session;
  if (!session?.meetingKey || !session.joinLink || !session.startLink) {
    throw new ZohoMeetingError("Zoho Meeting did not return the expected meeting links.", 502, zohoResponse);
  }

  const meetingRef = adminDb.collection(MEETINGS_COLLECTION).doc();
  const snapshot = buildMeetingStatusSnapshot({
    validated,
    actor,
    selectedUsers,
    additionalInviteEmails,
    audience,
    participantEmails,
    zoho: {
      connectionUid: actor.uid,
      organizationId: connection.organizationId,
      presenterZuid: connection.zuid,
      meetingKey: String(session.meetingKey),
      joinUrl: session.joinLink,
      startUrl: session.startLink,
      passwordMasked: typeof session.pwd === "string" ? session.pwd : null,
      encryptedPasswordMasked:
        typeof session.encryptPwd === "string" ? session.encryptPwd : null,
      embedUrl: typeof session.meetingEmbedUrl === "string" ? session.meetingEmbedUrl : null,
    },
    existingMeetingId: meetingRef.id,
  });

  await meetingRef.set(
    stripUndefinedDeep({
      ...snapshot,
      createdBy: toMeetingUserSnapshot(actor),
      updatedBy: toMeetingUserSnapshot(actor),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  await upsertParticipantRows(
    adminDb,
    meetingRef.id,
    snapshot.title,
    snapshot.startTimeMs,
    snapshot.audience,
    selectedUsers,
    additionalInviteEmails,
  );

  await writeServerAudit(adminDb, {
    action: "MEETING_CREATED",
    details: `${actor.displayName ?? actor.email ?? actor.uid} scheduled meeting "${snapshot.title}".`,
    actor: buildServerActor(actor),
    metadata: {
      meetingId: meetingRef.id,
      zohoMeetingId: snapshot.zoho.zohoMeetingId,
      participantCount: snapshot.participantCount,
    },
  });

  return readMeeting(adminDb, meetingRef.id);
}

export async function updateMeeting(adminDb: Firestore, actor: UserDoc, payload: UpdateMeetingInput) {
  ensureMeetingCreatePermission(actor);
  const existing = await readMeeting(adminDb, payload.meetingId);
  if (!canUserEditMeeting(actor, existing)) {
    throw new ZohoMeetingError("Forbidden: you do not have permission to edit this meeting.", 403);
  }

  const validated = validateMeetingInput(payload);
  const { selectedUsers, audience } = await resolveAudienceParticipants(adminDb, actor, payload.audience);
  const additionalInviteEmails = validated.additionalInviteEmails ?? [];
  const invalidInviteEmail = additionalInviteEmails.find((email) => !isValidEmail(email));
  if (invalidInviteEmail) {
    throw new ZohoMeetingError(`Invalid additional invite email: ${invalidInviteEmail}`, 400);
  }
  const participantEmails = uniqueStrings([
    ...selectedUsers.map((user) => normalizeEmail(user.email)),
    ...additionalInviteEmails,
  ]);
  if (participantEmails.length === 0) {
    throw new ZohoMeetingError(
      "Add at least one valid CRM participant or additional invite email.",
      400,
    );
  }
  if (participantEmails.length > ZOHO_MEETING_MAX_PARTICIPANTS) {
    throw new ZohoMeetingError(
      `Zoho Meeting supports up to ${ZOHO_MEETING_MAX_PARTICIPANTS} invitees per meeting. You selected ${participantEmails.length}. Choose a smaller audience or remove some external emails.`,
      400,
      {
        limit: ZOHO_MEETING_MAX_PARTICIPANTS,
        count: participantEmails.length,
        parameter: "participants",
      },
    );
  }
  const connection = await ensureFreshZohoConnection(adminDb, existing.zoho.connectionUid);
  const zohoResponse = await updateZohoMeeting(connection, existing.zoho.meetingKey, {
    ...validated,
    participantEmails,
  });
  const session = zohoResponse.session;

  const snapshot = buildMeetingStatusSnapshot({
    validated,
    actor,
    selectedUsers,
    additionalInviteEmails,
    audience,
    participantEmails,
    zoho: {
      connectionUid: existing.zoho.connectionUid,
      organizationId: connection.organizationId,
      presenterZuid: connection.zuid,
      meetingKey: existing.zoho.meetingKey,
      joinUrl:
        typeof session?.joinLink === "string" && session.joinLink.trim()
          ? session.joinLink
          : existing.zoho.joinUrl,
      startUrl:
        typeof session?.startLink === "string" && session.startLink.trim()
          ? session.startLink
          : existing.zoho.startUrl,
      passwordMasked:
        typeof session?.pwd === "string" ? session.pwd : existing.zoho.passwordMasked,
      encryptedPasswordMasked:
        typeof session?.encryptPwd === "string"
          ? session.encryptPwd
          : existing.zoho.encryptedPasswordMasked,
      embedUrl:
        typeof session?.meetingEmbedUrl === "string"
          ? session.meetingEmbedUrl
          : existing.zoho.embedUrl,
    },
    existingMeetingId: existing.id,
  });

  await adminDb.collection(MEETINGS_COLLECTION).doc(existing.id).set(
    stripUndefinedDeep({
      ...existing,
      ...snapshot,
      createdBy: existing.createdBy,
      updatedBy: toMeetingUserSnapshot(actor),
      updatedAt: FieldValue.serverTimestamp(),
      attendanceSummary: existing.attendanceSummary,
      recordingSummary: existing.recordingSummary,
    }),
    { merge: true },
  );
  await upsertParticipantRows(
    adminDb,
    existing.id,
    snapshot.title,
    snapshot.startTimeMs,
    snapshot.audience,
    selectedUsers,
    additionalInviteEmails,
  );

  await writeServerAudit(adminDb, {
    action: "MEETING_UPDATED",
    details: `${actor.displayName ?? actor.email ?? actor.uid} updated meeting "${snapshot.title}".`,
    actor: buildServerActor(actor),
    metadata: {
      meetingId: existing.id,
      zohoMeetingId: existing.zoho.zohoMeetingId,
      participantCount: snapshot.participantCount,
    },
  });

  return readMeeting(adminDb, existing.id);
}

export async function cancelMeeting(adminDb: Firestore, actor: UserDoc, payload: CancelMeetingInput) {
  const existing = await readMeeting(adminDb, payload.meetingId);
  if (!canUserEditMeeting(actor, existing)) {
    throw new ZohoMeetingError("Forbidden: you do not have permission to cancel this meeting.", 403);
  }

  const connection = await ensureFreshZohoConnection(adminDb, existing.zoho.connectionUid);
  await deleteZohoMeeting(connection, existing.zoho.meetingKey);

  await adminDb.collection(MEETINGS_COLLECTION).doc(existing.id).set(
    {
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: toMeetingUserSnapshot(actor),
      updatedBy: toMeetingUserSnapshot(actor),
      updatedAt: FieldValue.serverTimestamp(),
      "zoho.lastSyncError": null,
    },
    { merge: true },
  );

  await writeServerAudit(adminDb, {
    action: "MEETING_CANCELLED",
    details: `${actor.displayName ?? actor.email ?? actor.uid} cancelled meeting "${existing.title}".`,
    actor: buildServerActor(actor),
    metadata: {
      meetingId: existing.id,
      zohoMeetingId: existing.zoho.zohoMeetingId,
      reason: payload.reason ?? null,
    },
  });

  return readMeeting(adminDb, existing.id);
}

async function syncAttendanceForMeeting(
  adminDb: Firestore,
  meeting: MeetingDoc,
) {
  const connection = await ensureFreshZohoConnection(adminDb, meeting.zoho.connectionUid);
  const response = await fetchZohoParticipantReport(connection, meeting.zoho.meetingKey);
  const rawRows = response.participants ?? [];
  const participantSnapshot = await adminDb
    .collection(PARTICIPANTS_COLLECTION)
    .where("meetingId", "==", meeting.id)
    .get();

  const participantsByEmail = new Map<string, ParticipantDoc>();
  participantSnapshot.docs.forEach((doc) => {
    const row = { ...(doc.data() as ParticipantDoc), id: doc.id };
    participantsByEmail.set(row.email.trim().toLowerCase(), row);
  });

  const batch = adminDb.batch();
  let attended = 0;
  let totalDurationMs = 0;
  const touchedParticipantEmails = new Set<string>();

  rawRows.forEach((raw, index) => {
    const email =
      typeof raw.email === "string" && raw.email.trim()
        ? raw.email.trim().toLowerCase()
        : null;
    const participant = email ? participantsByEmail.get(email) ?? null : null;
    const joinedAtMs = readZohoEpochMs(raw.joinTime);
    const leftAtMs = readZohoEpochMs(raw.leaveTime);
    const durationMs = Math.max(
      0,
      typeof raw.duration === "number"
        ? raw.duration
        : Number(raw.duration ?? 0) || 0,
    );

    if (joinedAtMs || leftAtMs || durationMs > 0) {
      attended += 1;
      totalDurationMs += durationMs;
    }
    if (email) touchedParticipantEmails.add(email);

    const docId = attendanceDocId(
      meeting.id,
      email,
      typeof raw.memberId === "string" ? raw.memberId : null,
    );
    const attendancePayload: AttendanceDoc = {
      id: docId,
      meetingId: meeting.id,
      zohoMeetingId: meeting.zoho.zohoMeetingId,
      participantUid: participant?.participantUid ?? null,
      email,
      memberId: typeof raw.memberId === "string" ? raw.memberId : null,
      role: typeof raw.role === "string" ? raw.role : null,
      joinSource: typeof raw.source === "string" ? raw.source : null,
      joinedAtMs: joinedAtMs ?? null,
      leftAtMs: leftAtMs ?? null,
      durationMs,
      inAndOutTime: typeof raw.inAndOutTime === "string" ? raw.inAndOutTime : null,
      participantAvatar:
        typeof raw.participantAvatar === "string" ? raw.participantAvatar : null,
      syncedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      raw: raw as Record<string, unknown>,
    };
    batch.set(
      adminDb.collection(ATTENDANCE_COLLECTION).doc(docId),
      stripUndefinedDeep({
        ...attendancePayload,
        kind: "meeting",
      }),
      { merge: true },
    );

    if (participant) {
      batch.set(
        adminDb.collection(PARTICIPANTS_COLLECTION).doc(participant.id),
        {
          status:
            joinedAtMs || leftAtMs || durationMs > 0
              ? (leftAtMs ? "left" : "joined")
              : "invited",
          joinedAtMs: joinedAtMs ?? null,
          leftAtMs: leftAtMs ?? null,
          durationMs,
          zohoParticipantId:
            typeof raw.memberId === "string" ? raw.memberId : participant.zohoParticipantId ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    void index;
  });

  participantsByEmail.forEach((participant, email) => {
    if (touchedParticipantEmails.has(email)) return;
    batch.set(
      adminDb.collection(PARTICIPANTS_COLLECTION).doc(participant.id),
      {
        status: "no_show",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  batch.set(
    adminDb.collection(MEETINGS_COLLECTION).doc(meeting.id),
    {
      status: nowMeetingStatus(meeting),
      attendanceSummary: {
        invited: meeting.participantCount,
        attended,
        missed: Math.max(meeting.participantCount - attended, 0),
        totalDurationMs,
      },
      "zoho.lastAttendanceSyncAt": FieldValue.serverTimestamp(),
      "zoho.lastSuccessfulSyncAt": FieldValue.serverTimestamp(),
      "zoho.lastSyncError": null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();
  return attended;
}

async function syncRecordingsForMeeting(
  adminDb: Firestore,
  meeting: MeetingDoc,
) {
  const connection = await ensureFreshZohoConnection(adminDb, meeting.zoho.connectionUid);
  const response = await getZohoRecordingsForMeeting(connection, meeting.zoho.meetingKey);
  const rows = response.recordings ?? [];
  const batch = adminDb.batch();

  rows.forEach((raw) => {
    const recordingId =
      typeof raw.recordingId === "string" ? raw.recordingId : null;
    if (!recordingId) return;
    const docId = recordingId;
    const startTimeMs = readZohoEpochMs(raw.startTimeMillis);
    const endTimeMs = readZohoEpochMs(raw.endTimeMillis);
    const durationMs = Math.max(
      0,
      typeof raw.duration === "number" ? raw.duration : Number(raw.duration ?? 0) || 0,
    );

    const payload: RecordingDoc = {
      id: docId,
      meetingId: meeting.id,
      zohoConnectionUid: connection.uid,
      zohoOrganizationId: connection.organizationId,
      meetingKey: meeting.zoho.meetingKey,
      recordingId,
      encryptedRecordingId:
        typeof raw.erecordingId === "string" ? raw.erecordingId : null,
      topic: typeof raw.topic === "string" ? raw.topic : meeting.title,
      status: mapZohoRecordingStatus(raw.status ?? raw.processingState),
      durationMs,
      durationMinutes: Math.max(0, Math.round(durationMs / 60000)),
      startTimeMs,
      endTimeMs,
      uploadedAtMs: readZohoEpochMs(raw.uploadedTime),
      playUrl: typeof raw.playUrl === "string" ? raw.playUrl : null,
      shareUrl: typeof raw.shareUrl === "string" ? raw.shareUrl : null,
      downloadUrl: typeof raw.downloadUrl === "string" ? raw.downloadUrl : null,
      transcriptDownloadUrl:
        typeof raw.transcriptionDownloadUrl === "string"
          ? raw.transcriptionDownloadUrl
          : null,
      summaryDownloadUrl:
        typeof raw.summaryDownloadUrl === "string" ? raw.summaryDownloadUrl : null,
      fileSizeBytes: readZohoFileSizeBytes(raw.fileSize),
      fileSizeLabel:
        typeof raw.fileSize === "string"
          ? raw.fileSize
          : typeof raw.FileSize === "string"
            ? raw.FileSize
            : null,
      resourceName: typeof raw.resourceName === "string" ? raw.resourceName : null,
      isMeeting: Boolean(raw.isMeeting ?? true),
      isTranscriptGenerated: Boolean(raw.isTranscriptGenerated),
      isSummaryGenerated: Boolean(raw.isSummaryGenerated),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      syncedAt: FieldValue.serverTimestamp(),
      raw: raw as Record<string, unknown>,
    };
    batch.set(
      adminDb.collection(RECORDINGS_COLLECTION).doc(docId),
      stripUndefinedDeep(payload),
      { merge: true },
    );
  });

  batch.set(
    adminDb.collection(MEETINGS_COLLECTION).doc(meeting.id),
    {
      recordingSummary: {
        count: rows.length,
        lastRecordingSyncAt: FieldValue.serverTimestamp(),
      },
      "zoho.lastRecordingSyncAt": FieldValue.serverTimestamp(),
      "zoho.lastSuccessfulSyncAt": FieldValue.serverTimestamp(),
      "zoho.lastSyncError": null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();
  return rows.length;
}

async function markMeetingSyncError(adminDb: Firestore, meetingId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Zoho sync error";
  await adminDb.collection(MEETINGS_COLLECTION).doc(meetingId).set(
    {
      status: "sync_error",
      "zoho.lastSyncError": message,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function syncMeetingArtifacts(adminDb: Firestore, meeting: MeetingDoc) {
  if (meeting.status === "cancelled") {
    return { attendance: 0, recordings: 0 };
  }
  if (meeting.endTimeMs > Date.now()) {
    return { attendance: 0, recordings: 0 };
  }

  try {
    const [attendance, recordings] = await Promise.all([
      syncAttendanceForMeeting(adminDb, meeting),
      syncRecordingsForMeeting(adminDb, meeting),
    ]);
    return { attendance, recordings };
  } catch (error) {
    await markMeetingSyncError(adminDb, meeting.id, error);
    return { attendance: 0, recordings: 0 };
  }
}

export async function listMeetings(
  adminDb: Firestore,
  actor: UserDoc,
  mode: "upcoming" | "history",
) {
  const rawMeetings = await queryMeetingsForMode(adminDb, mode);
  const scopedDirectory = await getScopedDirectory(adminDb, actor);
  const scopedUids = new Set(scopedDirectory.map((user) => user.uid));

  const filtered = rawMeetings
    .map((meeting) => ({
      ...meeting,
      status: nowMeetingStatus(meeting),
    }))
    .filter((meeting) => {
      if (!canUserViewMeeting(actor, meeting, scopedUids)) return false;
      if (mode === "upcoming") {
        return meeting.status === "scheduled" || meeting.status === "live";
      }
      return meeting.status === "completed" || meeting.status === "cancelled" || meeting.status === "sync_error";
    });

  let attendanceSynced = 0;
  let recordingsSynced = 0;
  if (mode === "history") {
    const syncTargets = filtered.slice(0, 10);
    for (const meeting of syncTargets) {
      const synced = await syncMeetingArtifacts(adminDb, meeting);
      attendanceSynced += synced.attendance > 0 ? 1 : 0;
      recordingsSynced += synced.recordings > 0 ? 1 : 0;
    }
  }

  const refreshedMeetings = await Promise.all(
    filtered.map(async (meeting) => readMeeting(adminDb, meeting.id).catch(() => meeting)),
  );

  return {
    items: await toMeetingViewModels(adminDb, actor, refreshedMeetings),
    synced: {
      attendance: attendanceSynced,
      recordings: recordingsSynced,
    },
  };
}

export async function getMeetingById(adminDb: Firestore, actor: UserDoc, meetingId: string) {
  const meeting = await readMeeting(adminDb, meetingId);
  const scopedDirectory = await getScopedDirectory(adminDb, actor);
  const scopedUids = new Set(scopedDirectory.map((user) => user.uid));
  if (!canUserViewMeeting(actor, meeting, scopedUids)) {
    throw new ZohoMeetingError("Forbidden: you do not have access to this meeting.", 403);
  }
  const [viewModel] = await toMeetingViewModels(adminDb, actor, [meeting]);
  return viewModel;
}

export async function getMeetingsDashboard(adminDb: Firestore, actor: UserDoc) {
  const [upcoming, history] = await Promise.all([
    listMeetings(adminDb, actor, "upcoming"),
    listMeetings(adminDb, actor, "history"),
  ]);

  const now = Date.now();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const today = upcoming.items.filter(
    (meeting) =>
      meeting.startTimeMs >= todayStart.getTime() && meeting.startTimeMs <= endOfDay.getTime(),
  );
  const missed = history.items.filter((meeting) => {
    if (meeting.status === "cancelled") return false;
    const actorEmail = actor.email?.trim().toLowerCase();
    const selfAttendance = actorEmail
      ? meeting.participantRows.find((participant) => participant.email === actorEmail)
      : meeting.participantRows.find((participant) => participant.participantUid === actor.uid);
    const joined = Boolean(selfAttendance?.joinedAtMs || selfAttendance?.durationMs);
    return meeting.endTimeMs < now && !joined;
  });

  return {
    today: today.slice(0, 6),
    upcoming: upcoming.items.slice(0, 6),
    missed: missed.slice(0, 6),
    counts: {
      today: today.length,
      upcoming: upcoming.items.length,
      missed: missed.length,
    },
  };
}

export async function listAccessibleRecordings(adminDb: Firestore, actor: UserDoc) {
  const { items: historyMeetings } = await listMeetings(adminDb, actor, "history");
  const meetingIds = historyMeetings.map((meeting) => meeting.id);
  const connectionUids = uniqueStrings(historyMeetings.map((meeting) => meeting.zoho.connectionUid));

  for (const connectionUid of connectionUids) {
    try {
      const connection = await ensureFreshZohoConnection(adminDb, connectionUid);
      const response = await listZohoRecordings(connection);
      const batch = adminDb.batch();
      (response.recordings ?? []).forEach((raw) => {
        const recordingId =
          typeof raw.recordingId === "string" ? raw.recordingId : null;
        if (!recordingId) return;
        const matchedMeeting = historyMeetings.find(
          (meeting) =>
            meeting.zoho.meetingKey === String(raw.meetingKey ?? raw.short_meeting_key ?? ""),
        );
        const durationMs = Math.max(
          0,
          typeof raw.duration === "number" ? raw.duration : Number(raw.duration ?? 0) || 0,
        );
        const payload: RecordingDoc = {
          id: recordingId,
          meetingId: matchedMeeting?.id ?? null,
          zohoConnectionUid: connection.uid,
          zohoOrganizationId: connection.organizationId,
          meetingKey: String(raw.meetingKey ?? raw.short_meeting_key ?? ""),
          recordingId,
          encryptedRecordingId:
            typeof raw.erecordingId === "string" ? raw.erecordingId : null,
          topic: typeof raw.topic === "string" ? raw.topic : null,
          status: mapZohoRecordingStatus(raw.status),
          durationMs,
          durationMinutes: Math.max(0, Math.round(durationMs / 60000)),
          startTimeMs: readZohoEpochMs(raw.startTimeinMs ?? raw.startTimeMillis),
          endTimeMs: null,
          uploadedAtMs: null,
          playUrl: typeof raw.playUrl === "string" ? raw.playUrl : null,
          shareUrl: typeof raw.shareUrl === "string" ? raw.shareUrl : null,
          downloadUrl: typeof raw.downloadUrl === "string" ? raw.downloadUrl : null,
          transcriptDownloadUrl:
            typeof raw.transcriptionDownloadUrl === "string"
              ? raw.transcriptionDownloadUrl
              : null,
          summaryDownloadUrl:
            typeof raw.summaryDownloadUrl === "string" ? raw.summaryDownloadUrl : null,
          fileSizeBytes: readZohoFileSizeBytes(raw.fileSize),
          fileSizeLabel:
            typeof raw.fileSize === "string"
              ? raw.fileSize
              : typeof raw.FileSize === "string"
                ? raw.FileSize
                : null,
          resourceName: typeof raw.resourceName === "string" ? raw.resourceName : null,
          isMeeting: Boolean(raw.isMeeting),
          isTranscriptGenerated: Boolean(raw.isTranscriptGenerated),
          isSummaryGenerated: Boolean(raw.isSummaryGenerated),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          syncedAt: FieldValue.serverTimestamp(),
          raw: raw as Record<string, unknown>,
        };
        batch.set(
          adminDb.collection(RECORDINGS_COLLECTION).doc(recordingId),
          stripUndefinedDeep(payload),
          { merge: true },
        );
      });
      await batch.commit();
    } catch {
      // The list endpoint remains usable with cached local data even if remote sync fails.
    }
  }

  const results: RecordingDoc[] = [];
  if (meetingIds.length === 0) return results;

  const chunks: string[][] = [];
  for (let index = 0; index < meetingIds.length; index += 10) {
    chunks.push(meetingIds.slice(index, index + 10));
  }

  for (const chunk of chunks) {
    const snapshot = await adminDb
      .collection(RECORDINGS_COLLECTION)
      .where("meetingId", "in", chunk)
      .get();
    snapshot.docs.forEach((doc) => {
      results.push({ ...(doc.data() as RecordingDoc), id: doc.id });
    });
  }

  return results.sort((left, right) => (right.startTimeMs ?? 0) - (left.startTimeMs ?? 0));
}
