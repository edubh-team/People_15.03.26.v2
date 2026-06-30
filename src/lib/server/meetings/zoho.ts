import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

import type {
  CreateMeetingInput,
  RecordingDoc,
  ZohoMeetingConnectionDoc,
} from "@/lib/types/meetings";

type ZohoEnvConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accountsBaseUrl: string;
  apiBaseUrl: string;
  recordingApiBaseUrl: string;
  sourceLabel: string;
  scopes: string[];
};

type ZohoTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  expires_in_sec?: number;
  api_domain?: string;
};

type ZohoCurrentUserResponse = {
  userDetails?: {
    redirectionServer?: string;
    zuid?: number | string;
    zsoid?: number | string;
    primaryEmail?: string;
    portalName?: string;
    isAdmin?: boolean;
  };
};

type ZohoCreateMeetingResponse = {
  session?: {
    meetingKey?: number | string;
    topic?: string;
    agenda?: string;
    presenter?: number | string;
    startTime?: string;
    endTime?: string;
    duration?: number;
    timezone?: string;
    pwd?: string;
    encryptPwd?: string;
    joinLink?: string;
    startLink?: string;
    meetingEmbedUrl?: string;
    participants?: Array<{ id?: string; email?: string }>;
  };
};

type ZohoParticipantReportResponse = {
  participants?: Array<Record<string, unknown>>;
  participantsCount?: number;
};

type ZohoRecordingsResponse = {
  recordings?: Array<Record<string, unknown>>;
  count?: number;
  meta?: Record<string, unknown>;
};

type ZohoApiErrorPayload = {
  error?: {
    code?: number | string;
    key?: string;
    message?: string;
  } | string;
  error_description?: string;
  message?: string;
};

const DEFAULT_ACCOUNTS_BASE_URL = "https://accounts.zoho.com";
const DEFAULT_API_BASE_URL = "https://meeting.zoho.com/api/v2";
const DEFAULT_RECORDING_API_BASE_URL = "https://meeting.zoho.com/meeting/api/v2";
const DEFAULT_SOURCE_LABEL = "Edubh CRM";
const DEFAULT_SCOPES = [
  "ZohoMeeting.manageOrg.READ",
  "ZohoMeeting.meeting.READ",
  "ZohoMeeting.meeting.CREATE",
  "ZohoMeeting.meeting.UPDATE",
  "ZohoMeeting.meeting.DELETE",
  "ZohoMeeting.recording.READ",
];
const ZOHO_OAUTH_STATE_MAX_AGE_MS = 1000 * 60 * 15;

export type ZohoOauthStatePayload = {
  actorUid: string;
  nonce: string;
  redirectUri: string;
  returnTo: string;
  issuedAtMs: number;
};

export class ZohoMeetingError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status = 500, payload: unknown = null) {
    super(message);
    this.name = "ZohoMeetingError";
    this.status = status;
    this.payload = payload;
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function toBase64Url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signZohoOauthState(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function ensureEnv(name: string, value: string | undefined | null) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new ZohoMeetingError(`Missing required Zoho Meetings configuration: ${name}`, 500);
  }
  return normalized;
}

function readEnvAlias(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function deriveMeetingBaseUrlFromAccountsBase(accountsBaseUrl: string) {
  const url = new URL(accountsBaseUrl);
  const hostname = url.hostname.replace(/^accounts\./, "meeting.");
  return `${url.protocol}//${hostname}`;
}

function deriveMeetingApiBaseUrl(accountsBaseUrl: string) {
  return `${deriveMeetingBaseUrlFromAccountsBase(accountsBaseUrl)}/api/v2`;
}

function deriveMeetingRecordingApiBaseUrl(accountsBaseUrl: string) {
  return `${deriveMeetingBaseUrlFromAccountsBase(accountsBaseUrl)}/meeting/api/v2`;
}

export function getZohoMeetingEnv(): ZohoEnvConfig {
  const clientId = ensureEnv(
    "ZOHO_MEETING_CLIENT_ID or ZOHO_CLIENT_ID",
    readEnvAlias("ZOHO_MEETING_CLIENT_ID", "ZOHO_CLIENT_ID"),
  );
  const clientSecret = ensureEnv(
    "ZOHO_MEETING_CLIENT_SECRET or ZOHO_CLIENT_SECRET",
    readEnvAlias("ZOHO_MEETING_CLIENT_SECRET", "ZOHO_CLIENT_SECRET"),
  );
  const redirectUri = readEnvAlias("ZOHO_MEETING_REDIRECT_URI", "ZOHO_REDIRECT_URI")?.trim() || "";
  const accountsBaseUrl = trimTrailingSlash(
    readEnvAlias("ZOHO_MEETING_ACCOUNTS_BASE_URL", "ZOHO_ACCOUNTS_BASE_URL")
      || DEFAULT_ACCOUNTS_BASE_URL,
  );
  const apiBaseUrl = trimTrailingSlash(
    readEnvAlias("ZOHO_MEETING_API_BASE_URL", "ZOHO_API_BASE_URL")
      || deriveMeetingApiBaseUrl(accountsBaseUrl)
      || DEFAULT_API_BASE_URL,
  );
  const recordingApiBaseUrl = trimTrailingSlash(
    readEnvAlias(
      "ZOHO_MEETING_RECORDING_API_BASE_URL",
      "ZOHO_RECORDING_API_BASE_URL",
    ) || deriveMeetingRecordingApiBaseUrl(accountsBaseUrl) || DEFAULT_RECORDING_API_BASE_URL,
  );
  const sourceLabel = readEnvAlias("ZOHO_MEETING_SOURCE_LABEL", "ZOHO_SOURCE_LABEL")
    || DEFAULT_SOURCE_LABEL;
  const scopes = (
    process.env.ZOHO_MEETING_SCOPES?.split(",").map((item) => item.trim()).filter(Boolean)
    || DEFAULT_SCOPES
  );

  return {
    clientId,
    clientSecret,
    redirectUri,
    accountsBaseUrl,
    apiBaseUrl,
    recordingApiBaseUrl,
    sourceLabel,
    scopes,
  };
}

export function createSignedZohoOauthState(input: Omit<ZohoOauthStatePayload, "issuedAtMs">) {
  const config = getZohoMeetingEnv();
  const payload: ZohoOauthStatePayload = {
    ...input,
    issuedAtMs: Date.now(),
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signZohoOauthState(encodedPayload, config.clientSecret);
  return `${encodedPayload}.${signature}`;
}

export function readSignedZohoOauthState(state: string): ZohoOauthStatePayload | null {
  const normalized = state.trim();
  if (!normalized) return null;

  const [encodedPayload, signature] = normalized.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signZohoOauthState(encodedPayload, getZohoMeetingEnv().clientSecret);
  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as Partial<ZohoOauthStatePayload>;
    if (
      !payload
      || typeof payload.actorUid !== "string"
      || typeof payload.nonce !== "string"
      || typeof payload.redirectUri !== "string"
      || typeof payload.returnTo !== "string"
      || typeof payload.issuedAtMs !== "number"
    ) {
      return null;
    }
    if (Date.now() - payload.issuedAtMs > ZOHO_OAUTH_STATE_MAX_AGE_MS) {
      return null;
    }

    return {
      actorUid: payload.actorUid,
      nonce: payload.nonce,
      redirectUri: payload.redirectUri,
      returnTo: payload.returnTo,
      issuedAtMs: payload.issuedAtMs,
    };
  } catch {
    return null;
  }
}

function readExpiresInMs(payload: ZohoTokenResponse) {
  if (typeof payload.expires_in === "number") return payload.expires_in;
  if (typeof payload.expires_in_sec === "number") return payload.expires_in_sec * 1000;
  return 1000 * 60 * 55;
}

function buildUrl(base: string, path: string, query?: Record<string, string | number | null | undefined>) {
  const normalizedPath = path
    ? path.startsWith("/")
      ? path
      : `/${path}`
    : "";
  const url = new URL(`${trimTrailingSlash(base)}${normalizedPath}`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function readZohoErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const typed = payload as ZohoApiErrorPayload;
  if (typed.error && typeof typed.error === "object" && typeof typed.error.message === "string") {
    return typed.error.message.trim();
  }
  if (typeof typed.error === "string" && typed.error.trim()) {
    return typed.error.trim();
  }
  if (typeof typed.message === "string" && typed.message.trim()) {
    return typed.message.trim();
  }
  if (typeof typed.error_description === "string" && typed.error_description.trim()) {
    return typed.error_description.trim();
  }

  return null;
}

function toFriendlyZohoErrorMessage(message: string, status: number) {
  switch (message) {
    case "JSON_PARSE_ERROR":
      return "Zoho could not process the meeting details. Check the title, agenda, selected participants, and schedule, then try again.";
    case "ARRAY_SIZE_OUT_OF_RANGE":
      return "Zoho Meeting supports at most 100 invitees in one request. Reduce the participant list and try again.";
    case "INVALID_OAUTHTOKEN":
      return "Your Zoho Meeting connection has expired or is invalid. Reconnect Zoho and try again.";
    case "INVALID_REDIRECT_URI":
      return "Zoho OAuth redirect URI is misconfigured. Contact your administrator.";
    default:
      break;
  }

  if (status === 401 || status === 403) {
    return "Zoho rejected this request. Reconnect Zoho or confirm your Zoho account has permission to create meetings.";
  }
  if (status >= 500) {
    return "Zoho Meeting is unavailable right now. Please try again in a moment.";
  }
  return message;
}

async function parseZohoResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ZohoMeetingError(
        response.ok
          ? "Zoho returned an unreadable response."
          : "Zoho returned an unreadable error response.",
        response.status || 502,
        { rawText: text },
      );
    }
  }

  if (!response.ok) {
    const rawMessage = readZohoErrorMessage(payload)
      || `Zoho Meeting request failed with status ${response.status}`;
    throw new ZohoMeetingError(
      toFriendlyZohoErrorMessage(rawMessage, response.status),
      response.status,
      payload,
    );
  }
  return payload as T;
}

function ensureZohoTokenResponse(payload: ZohoTokenResponse) {
  if (payload?.access_token?.trim()) {
    return payload;
  }

  const errorPayload = payload as unknown as
    | { error?: string | { message?: string } ; error_description?: string; message?: string }
    | null;
  const message =
    (typeof errorPayload?.error === "string" && errorPayload.error) ||
    (errorPayload?.error &&
      typeof errorPayload.error === "object" &&
      typeof errorPayload.error.message === "string" &&
      errorPayload.error.message) ||
    errorPayload?.error_description ||
    errorPayload?.message ||
    "Zoho did not return an access token.";

  throw new ZohoMeetingError(message, 502, payload);
}

function buildZohoMeetingAuthorizationUrl(
  config: ZohoEnvConfig,
  state: string,
  redirectUri?: string,
) {
  return buildUrl(`${config.accountsBaseUrl}/oauth/v2/auth`, "", {
    scope: config.scopes.join(","),
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri || config.redirectUri,
    access_type: "offline",
    prompt: "consent",
    state,
  });
}

function resolveZohoMeetingRedirectUri(redirectUri?: string) {
  const normalized = redirectUri?.trim() || getZohoMeetingEnv().redirectUri;
  return ensureEnv(
    "ZOHO_MEETING_REDIRECT_URI or ZOHO_REDIRECT_URI",
    normalized,
  );
}

export function createZohoMeetingAuthorizationUrl(state: string, redirectUri?: string) {
  return buildZohoMeetingAuthorizationUrl(
    getZohoMeetingEnv(),
    state,
    resolveZohoMeetingRedirectUri(redirectUri),
  );
}

async function exchangeZohoToken(
  params: Record<string, string>,
): Promise<ZohoTokenResponse> {
  const config = getZohoMeetingEnv();
  const body = new URLSearchParams(params);
  const response = await fetch(`${config.accountsBaseUrl}/oauth/v2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
    cache: "no-store",
  });
  const payload = await parseZohoResponse<ZohoTokenResponse>(response);
  return ensureZohoTokenResponse(payload);
}

export async function exchangeZohoAuthorizationCode(code: string, redirectUri?: string) {
  const config = getZohoMeetingEnv();
  return exchangeZohoToken({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: resolveZohoMeetingRedirectUri(redirectUri),
    grant_type: "authorization_code",
  });
}

export async function refreshZohoAccessToken(refreshToken: string) {
  const config = getZohoMeetingEnv();
  return exchangeZohoToken({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "refresh_token",
  });
}

export async function revokeZohoToken(token: string) {
  const config = getZohoMeetingEnv();
  const body = new URLSearchParams({ token });
  const response = await fetch(`${config.accountsBaseUrl}/oauth/v2/token/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new ZohoMeetingError(
      "Zoho token revocation failed.",
      response.status,
      text ? { rawText: text } : null,
    );
  }

  if (!text.trim()) {
    return { status: "success" };
  }

  try {
    return JSON.parse(text) as { status?: string };
  } catch {
    return { status: "unknown" };
  }
}

function getMeetingApiBaseFromUser(
  fallbackBaseUrl: string,
  redirectionServer: string | null | undefined,
) {
  if (!redirectionServer?.trim()) return fallbackBaseUrl;
  return `https://${redirectionServer.trim()}/api/v2`;
}

function getRecordingApiBaseFromUser(
  fallbackBaseUrl: string,
  redirectionServer: string | null | undefined,
) {
  if (!redirectionServer?.trim()) return fallbackBaseUrl;
  return `https://${redirectionServer.trim()}/meeting/api/v2`;
}

export async function fetchZohoCurrentUser(accessToken: string) {
  if (!accessToken?.trim()) {
    throw new ZohoMeetingError("Zoho access token is missing after OAuth exchange.", 502);
  }
  const config = getZohoMeetingEnv();
  const response = await fetch(`${config.apiBaseUrl}/user.json`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "X-ZSOURCE": config.sourceLabel,
    },
    cache: "no-store",
  });
  const payload = await parseZohoResponse<ZohoCurrentUserResponse>(response);
  const user = payload.userDetails;
  if (!user?.zsoid || !user?.zuid) {
    throw new ZohoMeetingError("Zoho current user response is missing organization details.", 500, payload);
  }

  return {
    organizationId: String(user.zsoid),
    zuid: String(user.zuid),
    primaryEmail: user.primaryEmail?.trim().toLowerCase() || null,
    portalName: user.portalName?.trim() || null,
    redirectionServer: user.redirectionServer?.trim() || null,
    isAdmin: Boolean(user.isAdmin),
    apiBaseUrl: getMeetingApiBaseFromUser(config.apiBaseUrl, user.redirectionServer),
    recordingApiBaseUrl: getRecordingApiBaseFromUser(
      config.recordingApiBaseUrl,
      user.redirectionServer,
    ),
  };
}

export function buildZohoConnectionDocument(input: {
  uid: string;
  owner: ZohoMeetingConnectionDoc["owner"];
  token: ZohoTokenResponse;
  currentUser: Awaited<ReturnType<typeof fetchZohoCurrentUser>>;
}) {
  const config = getZohoMeetingEnv();
  const expiresInMs = readExpiresInMs(input.token);

  return {
    uid: input.uid,
    owner: input.owner,
    accessToken: input.token.access_token,
    refreshToken: input.token.refresh_token ?? "",
    tokenType: input.token.token_type || "Bearer",
    scopes: config.scopes,
    expiresAtMs: Date.now() + expiresInMs,
    accountsBaseUrl: config.accountsBaseUrl,
    apiBaseUrl: input.currentUser.apiBaseUrl,
    recordingApiBaseUrl: input.currentUser.recordingApiBaseUrl,
    organizationId: input.currentUser.organizationId,
    zuid: input.currentUser.zuid,
    primaryEmail: input.currentUser.primaryEmail,
    portalName: input.currentUser.portalName,
    redirectionServer: input.currentUser.redirectionServer,
    isAdmin: input.currentUser.isAdmin,
  };
}

function formatZohoMeetingTime(date: string, time: string) {
  const [year, month, day] = date.split("-").map((value) => Number(value));
  const [hoursRaw, minutesRaw] = time.split(":").map((value) => Number(value));
  const local = new Date(year, Math.max(0, month - 1), day, hoursRaw, minutesRaw || 0, 0, 0);
  const monthLabel = local.toLocaleString("en-US", { month: "short" });
  const dayLabel = String(local.getDate()).padStart(2, "0");
  const fullYear = local.getFullYear();
  const hours24 = local.getHours();
  const minutes = String(local.getMinutes()).padStart(2, "0");
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${monthLabel} ${dayLabel}, ${fullYear} ${String(hours12).padStart(2, "0")}:${minutes} ${period}`;
}

function buildCreateOrUpdatePayload(input: CreateMeetingInput, presenterZuid: string) {
  return {
    session: {
      topic: input.title.trim(),
      ...(input.agenda?.trim() ? { agenda: input.agenda.trim() } : {}),
      presenter: Number(presenterZuid),
      startTime: formatZohoMeetingTime(input.date, input.time),
      duration: Math.max(1, input.durationMinutes) * 60 * 1000,
      timezone: input.timezone,
    },
  };
}

async function zohoApiRequest<T>(input: {
  accessToken: string;
  baseUrl: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: string;
  contentType?: string;
  query?: Record<string, string | number | null | undefined>;
}) {
  const config = getZohoMeetingEnv();
  const url = buildUrl(input.baseUrl, input.path, input.query);
  const response = await fetch(url, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${input.accessToken}`,
      "X-ZSOURCE": config.sourceLabel,
      ...(input.body && input.contentType ? { "Content-Type": input.contentType } : {}),
    },
    body: input.body,
    cache: "no-store",
  });
  if (response.status === 204) {
    return null as T;
  }
  return parseZohoResponse<T>(response);
}

export async function createZohoMeeting(
  connection: ZohoMeetingConnectionDoc,
  input: CreateMeetingInput & { participantEmails: string[] },
) {
  const payload = buildCreateOrUpdatePayload(input, connection.zuid) as {
    session: Record<string, unknown>;
  };
  payload.session.participants = input.participantEmails.map((email) => ({ email }));

  return zohoApiRequest<ZohoCreateMeetingResponse>({
    accessToken: connection.accessToken,
    baseUrl: connection.apiBaseUrl,
    path: `/${connection.organizationId}/sessions.json`,
    method: "POST",
    body: JSON.stringify(payload),
    contentType: "application/json;charset=UTF-8",
  });
}

export async function updateZohoMeeting(
  connection: ZohoMeetingConnectionDoc,
  meetingKey: string,
  input: CreateMeetingInput & { participantEmails: string[] },
) {
  const payload = buildCreateOrUpdatePayload(input, connection.zuid) as {
    session: Record<string, unknown>;
  };
  payload.session.participants = input.participantEmails.map((email) => ({ email }));

  return zohoApiRequest<ZohoCreateMeetingResponse>({
    accessToken: connection.accessToken,
    baseUrl: connection.apiBaseUrl,
    path: `/${connection.organizationId}/sessions/${meetingKey}.json`,
    method: "PUT",
    body: JSON.stringify(payload),
    contentType: "application/json;charset=UTF-8",
  });
}

export async function deleteZohoMeeting(
  connection: ZohoMeetingConnectionDoc,
  meetingKey: string,
) {
  return zohoApiRequest<null>({
    accessToken: connection.accessToken,
    baseUrl: connection.apiBaseUrl,
    path: `/${connection.organizationId}/sessions/${meetingKey}.json`,
    method: "DELETE",
  });
}

export async function listZohoMeetings(
  connection: ZohoMeetingConnectionDoc,
  listType: "all" | "past" | "today" | "upcoming",
  index = 1,
  count = 100,
) {
  return zohoApiRequest<{
    session?: Array<Record<string, unknown>>;
    count?: number;
  }>({
    accessToken: connection.accessToken,
    baseUrl: connection.apiBaseUrl,
    path: `/${connection.organizationId}/sessions.json`,
    query: {
      listtype: listType,
      index,
      count,
    },
  });
}

export async function fetchZohoParticipantReport(
  connection: ZohoMeetingConnectionDoc,
  meetingKey: string,
  index = 1,
  count = 200,
) {
  return zohoApiRequest<ZohoParticipantReportResponse>({
    accessToken: connection.accessToken,
    baseUrl: connection.apiBaseUrl,
    path: `/${connection.organizationId}/participant/${meetingKey}.json`,
    query: {
      index,
      count,
    },
  });
}

export async function listZohoRecordings(connection: ZohoMeetingConnectionDoc) {
  return zohoApiRequest<ZohoRecordingsResponse>({
    accessToken: connection.accessToken,
    baseUrl: connection.recordingApiBaseUrl,
    path: `/${connection.organizationId}/recordings.json`,
  });
}

export async function getZohoRecordingsForMeeting(
  connection: ZohoMeetingConnectionDoc,
  meetingKey: string,
) {
  return zohoApiRequest<ZohoRecordingsResponse>({
    accessToken: connection.accessToken,
    baseUrl: connection.recordingApiBaseUrl,
    path: `/${connection.organizationId}/recordings/${meetingKey}.json`,
  });
}

export function mapZohoRecordingStatus(value: unknown): RecordingDoc["status"] {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "UPLOADED" || normalized === "PROCESSING" || normalized === "FAILED") {
    return normalized;
  }
  return "UNKNOWN";
}

export function readZohoEpochMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readZohoFileSizeBytes(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return null;
}
