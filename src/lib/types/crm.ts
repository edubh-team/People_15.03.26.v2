import type { CanonicalLeadStatus, LeadStatusLegacyAlias } from "@/lib/leads/status";

export type LeadStatus = CanonicalLeadStatus | LeadStatusLegacyAlias;

export type LeadAuditLog = {
  action: string;
  oldStatus?: string;
  newStatus?: string;
  remarks?: string;
  updatedBy: string;
  updatedByName?: string;
  timestamp: unknown;
};

export type LeadActivity = {
  type:
    | "created"
    | "contacted"
    | "updated"
    | "closed"
    | "outgoing_call"
    | "reassigned"
    | "duplicate_review";
  at: unknown;
  note?: string | null;
};

export type LeadTimelineActor = {
  uid: string;
  name: string | null;
  role?: string | null;
  employeeId?: string | null;
};

export type LeadTimelineEventType =
  | "created"
  | "status_updated"
  | "details_updated"
  | "reassigned"
  | "closed"
  | "refund_initiated"
  | "duplicate_flagged"
  | "duplicate_merged"
  | "bulk_action_applied"
  | "activity_logged"
  | "note_added"
  | "document_added"
  | "task_created";

export type LeadTimelineEvent = {
  id: string;
  type: LeadTimelineEventType;
  summary: string;
  actor: LeadTimelineActor;
  metadata?: Record<string, unknown> | null;
  createdAt: unknown;
};

export type LeadNoteDoc = {
  id: string;
  body: string;
  author: LeadTimelineActor;
  createdAt: unknown;
};

export type LeadStructuredActivityType =
  | "call_connected"
  | "call_not_connected"
  | "demo_done"
  | "docs_requested"
  | "docs_received"
  | "fee_discussed"
  | "parent_call"
  | "payment_reminder";

export type LeadActivityDoc = {
  id: string;
  type: LeadStructuredActivityType;
  channel: "call" | "meeting" | "document" | "payment";
  summary: string;
  note?: string | null;
  happenedAt: unknown;
  followUpAt?: unknown | null;
  relatedStatus?: string | null;
  actor: LeadTimelineActor;
  metadata?: Record<string, unknown> | null;
  createdAt: unknown;
};

export type LeadDocumentDoc = {
  id: string;
  title: string;
  url: string;
  category: string;
  note?: string | null;
  uploadedBy: LeadTimelineActor;
  createdAt: unknown;
};

export type LeadCommunicationChannel = "call" | "whatsapp" | "email";

export type LeadCommunicationDoc = {
  id: string;
  channel: LeadCommunicationChannel;
  direction: "outbound" | "inbound";
  templateId?: string | null;
  templateLabel?: string | null;
  subject?: string | null;
  body: string;
  outcome?: string | null;
  actor: LeadTimelineActor;
  createdAt: unknown;
};

export type LeadMergeState = "active" | "merged";

export type LeadCustodyState =
  | "owned"
  | "pulled_back"
  | "pooled"
  | "reassigned"
  | "locked";

export type LeadTransferRecord = {
  id: string;
  custodyState: LeadCustodyState;
  reason: string;
  previousOwnerUid: string | null;
  previousOwnerName?: string | null;
  currentOwnerUid: string | null;
  currentOwnerName?: string | null;
  transferredBy: LeadTimelineActor;
  transferredAt: unknown;
};

export type LeadStatusDetail = {
  currentStage: string;
  currentReason: string;
  lastUpdated: unknown;
  isLocked?: boolean;
  history: Array<{ stage: string; reason: string; updatedAt: unknown }>;
};

export type LeadDoc = {
  leadId: string;
  name: string;
  phone: string | null;
  email: string | null;
  normalizedPhone?: string | null;
  normalizedEmail?: string | null;
  normalizedName?: string | null;
  currentEducation: string | null;
  targetDegree: string | null;
  targetUniversity: string | null;
  leadLocation?: string | null;
  preferredLanguage?: string | null;
  courseFees: number | null;
  remarks?: string;
  status: LeadStatus;
  assignedTo: string | null;
  assignedBy?: string | null;
  assignedAt?: unknown;
  lastActionAt?: unknown;
  lastActionBy?: string | null;
  lastActivityAt?: unknown;
  lastActivityType?: LeadStructuredActivityType | null;
  activityHistory: LeadActivity[];
  history?: LeadAuditLog[];
  statusDetail?: LeadStatusDetail | null;
  kycData: {
    aadhar: string | null;
    pan: string | null;
    address: string | null;
    parentDetails: string | null;
  };
  ownerUid: string | null;
  createdDateKey?: string;
  lastContactDateKey?: string;
  nextFollowUpDateKey?: string | null;
  nextFollowUp?: unknown | null;
  legacyStatus?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  closedAt?: unknown;
  // Closure / Enrollment Details
  subStatus?: string | null;
  enrollmentDetails?: {
    university: string;
    course: string;
    fee: number;
    registrationFee?: number;
    payableAmount?: number;
    emiDetails: string;
    paymentMode?: string;
    utrNumber?: string;
    closedAt: unknown;
  } | null;
  closedBy?: {
    uid: string;
    name: string | null;
    employeeId?: string | null;
  } | null;
  isSelfGenerated?: boolean;
  source?: string;
  sourceNormalized?: string | null;
  campaignName?: string | null;
  importBatchId?: string | null;
  importTags?: string[] | null;
  importTagsNormalized?: string[] | null;
  importFileName?: string | null;
  importedAt?: unknown;
  importedBy?: LeadTimelineActor | null;
  leadTags?: string[] | null;
  leadTagsNormalized?: string[] | null;
  duplicateFlag?: boolean;
  duplicateReasons?: string[] | null;
  duplicateCandidateLeadIds?: string[] | null;
  duplicateScore?: number | null;
  duplicateDetectedAt?: unknown;
  duplicateDetectionSource?: "import" | "create" | "manual" | null;
  incentiveOwnerId?: string;
  custodyState?: LeadCustodyState | null;
  custodyReason?: string | null;
  custodyUpdatedAt?: unknown;
  lastTransfer?: LeadTransferRecord | null;
  transferHistory?: LeadTransferRecord[] | null;
  mergeState?: LeadMergeState | null;
  mergedIntoLeadId?: string | null;
  mergedAt?: unknown;
  mergedBy?: LeadTimelineActor | null;
  mergedLeadIds?: string[] | null;
  createdBy?: {
    uid: string;
    name: string | null;
    role?: string | null;
    employeeId?: string | null;
  };
};
