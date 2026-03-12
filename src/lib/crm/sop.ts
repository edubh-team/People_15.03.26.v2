import { PAYMENT_FOLLOW_UP_STATUS, normalizeLeadStatus, type CanonicalLeadStatus } from "@/lib/leads/status";
import type { LeadDoc } from "@/lib/types/crm";

export const SOP_STAGE_NOT_CONNECTED = "Call Not Connected (Invalid Details)";
export const SOP_STAGE_CONNECTED = "Call Connected (Pitch Call)";
export const SOP_STAGE_PAYMENT = "Payment Follow Up (Registration Done)";

export type LeadSopOutcomeId =
  | "first_connect"
  | "callback_tomorrow"
  | "no_connect_retry"
  | "payment_follow_up"
  | "not_interested";

export type LeadSopOutcomePreset = {
  id: LeadSopOutcomeId;
  label: string;
  shortLabel: string;
  stage: string;
  reason: string;
  status: CanonicalLeadStatus;
  followUpHours: number | null;
  remarksTemplate: string;
};

export type LeadSopDraft = {
  preset: LeadSopOutcomePreset;
  stage: string;
  reason: string;
  status: CanonicalLeadStatus;
  remarks: string;
  followUpAt: Date | null;
};

export type AssignmentReasonTemplateId =
  | "workload_balance"
  | "manager_pullback"
  | "ownership_fix"
  | "quality_review"
  | "availability_cover";

export type AssignmentReasonTemplate = {
  id: AssignmentReasonTemplateId;
  label: string;
  text: string;
};

const SOP_OUTCOME_PRESETS: LeadSopOutcomePreset[] = [
  {
    id: "first_connect",
    label: "First Connect",
    shortLabel: "First connect",
    stage: SOP_STAGE_CONNECTED,
    reason: "Ringing",
    status: "interested",
    followUpHours: 24,
    remarksTemplate: "Lead connected on intro call. Qualification completed and next conversation committed.",
  },
  {
    id: "callback_tomorrow",
    label: "Callback Tomorrow",
    shortLabel: "Callback",
    stage: SOP_STAGE_CONNECTED,
    reason: "Asked to Call Back",
    status: "followup",
    followUpHours: 24,
    remarksTemplate: "Lead requested callback. Committed follow-up window logged as per call SOP.",
  },
  {
    id: "no_connect_retry",
    label: "No Connect Retry",
    shortLabel: "No connect",
    stage: SOP_STAGE_NOT_CONNECTED,
    reason: "No Incoming",
    status: "followup",
    followUpHours: 24,
    remarksTemplate: "Call attempt made but lead did not connect. Retry scheduled as per no-connect SOP.",
  },
  {
    id: "payment_follow_up",
    label: "Payment Follow Up",
    shortLabel: "Payment FU",
    stage: SOP_STAGE_PAYMENT,
    reason: "Payment Follow Up",
    status: PAYMENT_FOLLOW_UP_STATUS,
    followUpHours: 24,
    remarksTemplate: "Payment reminder shared with lead and next payment check scheduled.",
  },
  {
    id: "not_interested",
    label: "Not Interested",
    shortLabel: "Not interested",
    stage: SOP_STAGE_CONNECTED,
    reason: "Not Interested",
    status: "not_interested",
    followUpHours: null,
    remarksTemplate: "Lead clearly declined further discussion. Disposition captured as per closure SOP.",
  },
];

const ASSIGNMENT_REASON_TEMPLATES: AssignmentReasonTemplate[] = [
  {
    id: "workload_balance",
    label: "Workload balancing",
    text: "Reassigned for workload balancing to maintain follow-up SLA coverage.",
  },
  {
    id: "manager_pullback",
    label: "Manager pullback",
    text: "Pulled back by manager before redistribution as per hierarchy control SOP.",
  },
  {
    id: "ownership_fix",
    label: "Owner correction",
    text: "Lead owner corrected to fix routing mismatch in current hierarchy scope.",
  },
  {
    id: "quality_review",
    label: "Quality review",
    text: "Transferred for manager quality review and recovery handling.",
  },
  {
    id: "availability_cover",
    label: "Availability cover",
    text: "Reassigned for leave/shift availability coverage to prevent follow-up breach.",
  },
];

export const DEFAULT_REASSIGN_REASON_TEMPLATE_ID: AssignmentReasonTemplateId = "workload_balance";
export const DEFAULT_PULLBACK_REASON_TEMPLATE_ID: AssignmentReasonTemplateId = "manager_pullback";

function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addHours(base: Date, hours: number) {
  const next = new Date(base);
  next.setHours(next.getHours() + hours, 0, 0, 0);
  return next;
}

function firstName(lead: Pick<LeadDoc, "name">) {
  return lead.name?.trim().split(/\s+/)[0] ?? "Lead";
}

function getProgramLabel(lead: Pick<LeadDoc, "targetDegree" | "targetUniversity" | "enrollmentDetails">) {
  return (
    [
      lead.enrollmentDetails?.course,
      lead.targetDegree,
      lead.enrollmentDetails?.university,
      lead.targetUniversity,
    ]
      .filter(Boolean)
      .join(" | ") || "program"
  );
}

function compileRemarks(
  template: string,
  input: {
    lead: Pick<LeadDoc, "name" | "targetDegree" | "targetUniversity" | "enrollmentDetails">;
    actorName?: string | null;
  },
) {
  return template
    .replaceAll("{{firstName}}", firstName(input.lead))
    .replaceAll("{{program}}", getProgramLabel(input.lead))
    .replaceAll("{{ownerName}}", input.actorName?.trim() || "Owner");
}

export function getLeadSopOutcomePresets(
  lead: Pick<LeadDoc, "status">,
): LeadSopOutcomePreset[] {
  const normalizedStatus = normalizeLeadStatus(lead.status);
  if (normalizedStatus === "closed" || normalizedStatus === "converted") {
    return SOP_OUTCOME_PRESETS.filter((preset) =>
      preset.id === "callback_tomorrow" || preset.id === "first_connect",
    );
  }
  if (normalizedStatus === PAYMENT_FOLLOW_UP_STATUS) {
    return [
      getLeadSopOutcomePreset("payment_follow_up"),
      getLeadSopOutcomePreset("callback_tomorrow"),
      getLeadSopOutcomePreset("not_interested"),
    ];
  }
  return [...SOP_OUTCOME_PRESETS];
}

export function getLeadSopOutcomePreset(outcomeId: LeadSopOutcomeId) {
  return (
    SOP_OUTCOME_PRESETS.find((preset) => preset.id === outcomeId) ??
    SOP_OUTCOME_PRESETS[0]
  )!;
}

export function buildLeadSopDraft(input: {
  lead: Pick<
    LeadDoc,
    "name" | "status" | "targetDegree" | "targetUniversity" | "enrollmentDetails" | "nextFollowUp"
  >;
  outcomeId: LeadSopOutcomeId;
  actorName?: string | null;
  baseDate?: Date;
}): LeadSopDraft {
  const preset = getLeadSopOutcomePreset(input.outcomeId);
  const baseDate = input.baseDate ?? toDate(input.lead.nextFollowUp) ?? new Date();
  return {
    preset,
    stage: preset.stage,
    reason: preset.reason,
    status: preset.status,
    remarks: compileRemarks(preset.remarksTemplate, {
      lead: input.lead,
      actorName: input.actorName,
    }),
    followUpAt:
      preset.followUpHours !== null
        ? addHours(baseDate, preset.followUpHours)
        : null,
  };
}

export function findSopPresetByStageReason(input: { stage: string; reason: string }) {
  const stage = input.stage.trim().toLowerCase();
  const reason = input.reason.trim().toLowerCase();
  return (
    SOP_OUTCOME_PRESETS.find(
      (preset) =>
        preset.stage.trim().toLowerCase() === stage &&
        preset.reason.trim().toLowerCase() === reason,
    ) ?? null
  );
}

export function getDefaultSopOutcomeForWorkbenchTab(tabId: string): LeadSopOutcomeId {
  switch (tabId) {
    case "callbacks":
    case "due_today":
      return "callback_tomorrow";
    case "payment_follow_up":
      return "payment_follow_up";
    case "no_activity_24h":
      return "no_connect_retry";
    case "my_closures":
      return "first_connect";
    case "worked_leads":
      return "callback_tomorrow";
    case "new_leads":
    default:
      return "first_connect";
  }
}

export function getAssignmentReasonTemplates() {
  return ASSIGNMENT_REASON_TEMPLATES;
}

export function getAssignmentReasonTemplate(id: AssignmentReasonTemplateId) {
  return (
    ASSIGNMENT_REASON_TEMPLATES.find((template) => template.id === id) ??
    ASSIGNMENT_REASON_TEMPLATES[0]
  )!;
}
