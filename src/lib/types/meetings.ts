export type MeetingLifecycleStatus =
  | "scheduled"
  | "live"
  | "completed"
  | "cancelled"
  | "sync_error";

export type MeetingAudienceMode = "team" | "department" | "individual";

export type MeetingParticipantStatus =
  | "invited"
  | "joined"
  | "left"
  | "no_show"
  | "removed";

export type MeetingRecordingStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "FAILED"
  | "UNKNOWN";

export type MeetingUserSnapshot = {
  uid: string;
  email: string | null;
  displayName: string | null;
  role?: string | null;
  orgRole?: string | null;
  department?: string | null;
  employeeId?: string | null;
};

export type MeetingAudienceSelection = {
  mode: MeetingAudienceMode;
  departmentNames: string[];
  participantUids: string[];
  excludedParticipantUids: string[];
  scopeSummary: string;
};

export type ZohoMeetingSnapshot = {
  connectionUid: string;
  organizationId: string;
  presenterZuid: string;
  zohoMeetingId: string;
  joinUrl: string;
  startUrl: string;
  passwordMasked?: string | null;
  encryptedPasswordMasked?: string | null;
  embedUrl?: string | null;
  meetingKey: string;
  lastAttendanceSyncAt?: unknown;
  lastRecordingSyncAt?: unknown;
  lastSyncError?: string | null;
  lastSuccessfulSyncAt?: unknown;
};

export type MeetingAttendanceSummary = {
  invited: number;
  attended: number;
  missed: number;
  totalDurationMs: number;
};

export type MeetingRecordingSummary = {
  count: number;
  lastRecordingSyncAt?: unknown;
};

export type MeetingDoc = {
  id: string;
  title: string;
  agenda: string | null;
  date: string;
  time: string;
  timezone: string;
  startTimeLabel: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMinutes: number;
  status: MeetingLifecycleStatus;
  audience: MeetingAudienceSelection;
  participantCount: number;
  participantUserUids: string[];
  participantEmails: string[];
  externalParticipantEmails: string[];
  createdBy: MeetingUserSnapshot;
  updatedBy: MeetingUserSnapshot;
  cancelledBy?: MeetingUserSnapshot | null;
  host: MeetingUserSnapshot;
  zoho: ZohoMeetingSnapshot;
  attendanceSummary: MeetingAttendanceSummary;
  recordingSummary: MeetingRecordingSummary;
  createdAt: unknown;
  updatedAt: unknown;
  cancelledAt?: unknown;
  completedAt?: unknown;
};

export type ParticipantDoc = {
  id: string;
  meetingId: string;
  meetingTitle: string;
  meetingStartTimeMs: number;
  participantUid: string | null;
  email: string;
  displayName: string;
  role: string | null;
  orgRole: string | null;
  department: string | null;
  employeeId: string | null;
  audienceMode: MeetingAudienceMode;
  audienceSourceLabel: string;
  status: MeetingParticipantStatus;
  zohoParticipantId?: string | null;
  joinedAtMs?: number | null;
  leftAtMs?: number | null;
  durationMs?: number | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type AttendanceDoc = {
  id: string;
  meetingId: string;
  zohoMeetingId: string;
  participantUid: string | null;
  email: string | null;
  memberId: string | null;
  role: string | null;
  joinSource: string | null;
  joinedAtMs: number | null;
  leftAtMs: number | null;
  durationMs: number;
  inAndOutTime: string | null;
  participantAvatar: string | null;
  syncedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  raw: Record<string, unknown>;
};

export type RecordingDoc = {
  id: string;
  meetingId: string | null;
  zohoConnectionUid: string;
  zohoOrganizationId: string;
  meetingKey: string;
  recordingId: string;
  encryptedRecordingId: string | null;
  topic: string | null;
  status: MeetingRecordingStatus;
  durationMs: number;
  durationMinutes: number;
  startTimeMs: number | null;
  endTimeMs: number | null;
  uploadedAtMs: number | null;
  playUrl: string | null;
  shareUrl: string | null;
  downloadUrl: string | null;
  transcriptDownloadUrl: string | null;
  summaryDownloadUrl: string | null;
  fileSizeBytes: number | null;
  fileSizeLabel: string | null;
  resourceName: string | null;
  isMeeting: boolean;
  isTranscriptGenerated: boolean;
  isSummaryGenerated: boolean;
  createdAt: unknown;
  updatedAt: unknown;
  syncedAt: unknown;
  raw: Record<string, unknown>;
};

export type ZohoMeetingConnectionDoc = {
  uid: string;
  owner: MeetingUserSnapshot;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scopes: string[];
  expiresAtMs: number;
  accountsBaseUrl: string;
  apiBaseUrl: string;
  recordingApiBaseUrl: string;
  organizationId: string;
  zuid: string;
  primaryEmail: string | null;
  portalName: string | null;
  redirectionServer: string | null;
  isAdmin: boolean;
  connectedAt: unknown;
  updatedAt: unknown;
  lastRefreshAt?: unknown;
  lastError?: string | null;
};

export type MeetingParticipantOption = {
  uid: string;
  email: string | null;
  displayName: string;
  role: string | null;
  orgRole: string | null;
  department: string | null;
  employeeId: string | null;
};

export type MeetingAudienceResponse = {
  success: true;
  zohoConnected: boolean;
  connectionOwnerUid: string | null;
  zohoConnection: {
    uid: string;
    primaryEmail: string | null;
    ownerDisplayName: string | null;
    portalName: string | null;
  } | null;
  availableDepartments: string[];
  participants: MeetingParticipantOption[];
  defaults: {
    timezone: string;
  };
};

export type MeetingCardActionAccess = {
  canEdit: boolean;
  canCancel: boolean;
  canStart: boolean;
  canJoin: boolean;
};

export type MeetingViewModel = MeetingDoc & {
  participantRows: ParticipantDoc[];
  actionAccess: MeetingCardActionAccess;
};

export type MeetingsListResponse = {
  success: true;
  items: MeetingViewModel[];
  synced: {
    attendance: number;
    recordings: number;
  };
};

export type MeetingDashboardResponse = {
  success: true;
  today: MeetingViewModel[];
  upcoming: MeetingViewModel[];
  missed: MeetingViewModel[];
  counts: {
    today: number;
    upcoming: number;
    missed: number;
  };
};

export type MeetingRecordingsResponse = {
  success: true;
  items: RecordingDoc[];
};

export type MeetingMutationResponse = {
  success: true;
  meeting: MeetingViewModel;
  message: string;
};

export type MeetingDetailResponse = {
  success: true;
  meeting: MeetingViewModel;
};

export type CreateMeetingInput = {
  title: string;
  agenda?: string | null;
  date: string;
  time: string;
  timezone: string;
  startTimeMs: number;
  durationMinutes: number;
  additionalInviteEmails?: string[];
  audience: {
    mode: MeetingAudienceMode;
    departmentNames?: string[];
    participantUids?: string[];
    excludedParticipantUids?: string[];
  };
};

export type UpdateMeetingInput = CreateMeetingInput & {
  meetingId: string;
};

export type CancelMeetingInput = {
  meetingId: string;
  reason?: string | null;
};
