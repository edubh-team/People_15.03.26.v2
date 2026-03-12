export const CANONICAL_LEAD_STATUSES = [
  "new",
  "ringing",
  "followup",
  "interested",
  "not_interested",
  "wrong_number",
  "paymentfollowup",
  "converted",
  "closed",
] as const;

export type CanonicalLeadStatus = typeof CANONICAL_LEAD_STATUSES[number];

export type LeadStatusLegacyAlias =
  | "New"
  | "Ringing"
  | "FollowUp"
  | "Interested"
  | "NotInterested"
  | "WrongNumber"
  | "Converted"
  | "PaymentFollowUp"
  | "hot"
  | "warm"
  | "cold"
  | "contacted"
  | "notinterested"
  | "wrongnumber"
  | "Closed";

const FALLBACK_STATUS: CanonicalLeadStatus = "new";

const STATUS_ALIASES: Record<string, CanonicalLeadStatus> = {
  new: "new",
  New: "new",
  ringing: "ringing",
  Ringing: "ringing",
  followup: "followup",
  FollowUp: "followup",
  follow_up: "followup",
  contacted: "followup",
  Contacted: "followup",
  warm: "followup",
  Warm: "followup",
  interested: "interested",
  Interested: "interested",
  hot: "interested",
  Hot: "interested",
  not_interested: "not_interested",
  notinterested: "not_interested",
  NotInterested: "not_interested",
  "Not Interested": "not_interested",
  cold: "not_interested",
  Cold: "not_interested",
  wrong_number: "wrong_number",
  wrongnumber: "wrong_number",
  WrongNumber: "wrong_number",
  "Wrong Number": "wrong_number",
  paymentfollowup: "paymentfollowup",
  payment_follow_up: "paymentfollowup",
  PaymentFollowUp: "paymentfollowup",
  converted: "converted",
  Converted: "converted",
  closed: "closed",
  Closed: "closed",
};

const STATUS_LABELS: Record<CanonicalLeadStatus, string> = {
  new: "New",
  ringing: "Ringing / No Answer",
  followup: "Follow Up / Call Back",
  interested: "Interested / Potential",
  not_interested: "Not Interested / Dead",
  wrong_number: "Wrong Number / Invalid",
  paymentfollowup: "Payment Follow Up (Registration Done)",
  converted: "Admission Taken / Converted",
  closed: "Closed",
};

const STATUS_VARIANTS: Record<CanonicalLeadStatus, string[]> = {
  new: ["new", "New"],
  ringing: ["ringing", "Ringing"],
  followup: ["followup", "FollowUp", "follow_up", "contacted", "Contacted", "warm", "Warm"],
  interested: ["interested", "Interested", "hot", "Hot"],
  not_interested: [
    "not_interested",
    "notinterested",
    "NotInterested",
    "Not Interested",
    "cold",
    "Cold",
  ],
  wrong_number: ["wrong_number", "wrongnumber", "WrongNumber", "Wrong Number"],
  paymentfollowup: ["paymentfollowup", "payment_follow_up", "PaymentFollowUp"],
  converted: ["converted", "Converted"],
  closed: ["closed", "Closed"],
};

const STATUS_BUCKETS = {
  new: ["new"],
  contacted: ["ringing", "followup"],
  interested: ["interested"],
  closed: ["closed", "converted"],
} as const;

export type LeadStatusBucket = keyof typeof STATUS_BUCKETS;

export const PAYMENT_FOLLOW_UP_STATUS: CanonicalLeadStatus = "paymentfollowup";

export function normalizeLeadStatus(status: string | null | undefined): CanonicalLeadStatus {
  if (!status) return FALLBACK_STATUS;
  return STATUS_ALIASES[status] ?? STATUS_ALIASES[status.trim()] ?? FALLBACK_STATUS;
}

export function toStoredLeadStatus(status: string | null | undefined): CanonicalLeadStatus {
  return normalizeLeadStatus(status);
}

export function getLeadStatusLabel(status: string | null | undefined) {
  return STATUS_LABELS[normalizeLeadStatus(status)];
}

export function getLeadStatusVariants(...statuses: CanonicalLeadStatus[]) {
  return Array.from(new Set(statuses.flatMap((status) => STATUS_VARIANTS[status])));
}

export function getLeadStatusBucketVariants(bucket: LeadStatusBucket) {
  return getLeadStatusVariants(...STATUS_BUCKETS[bucket]);
}

export function isFollowUpStatus(status: string | null | undefined) {
  return normalizeLeadStatus(status) === "followup";
}

export function isPaymentFollowUpStatus(status: string | null | undefined) {
  return normalizeLeadStatus(status) === PAYMENT_FOLLOW_UP_STATUS;
}

export function isClosedLeadStatus(status: string | null | undefined) {
  const normalized = normalizeLeadStatus(status);
  return normalized === "closed" || normalized === "converted";
}
