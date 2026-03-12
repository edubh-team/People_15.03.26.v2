import type { CanonicalLeadStatus } from "@/lib/leads/status";

export const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "ringing", label: "Ringing / No Answer" },
  { value: "followup", label: "Follow Up / Call Back" },
  { value: "interested", label: "Interested / Potential" },
  { value: "not_interested", label: "Not Interested / Dead" },
  { value: "wrong_number", label: "Wrong Number / Invalid" },
  { value: "converted", label: "Admission Taken / Converted" },
  { value: "paymentfollowup", label: "Payment Follow Up (Registration Done)" },
] as const satisfies ReadonlyArray<{
  value: CanonicalLeadStatus;
  label: string;
}>;

export type LeadStatusValue = typeof LEAD_STATUS_OPTIONS[number]["value"];
