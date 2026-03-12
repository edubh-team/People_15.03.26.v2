import {
  getLeadStatusLabel,
  isPaymentFollowUpStatus,
  normalizeLeadStatus,
} from "@/lib/leads/status";
import type { LeadCommandTaskDoc } from "@/lib/crm/command-center";
import type { LeadActivityDoc, LeadDoc, LeadStructuredActivityType } from "@/lib/types/crm";

export type CommunicationChannel = "whatsapp" | "email";

export type CommunicationTemplate = {
  id: string;
  channel: CommunicationChannel;
  label: string;
  activityType: LeadStructuredActivityType;
  subject?: string;
  body: string;
};

export type CommunicationOutcomePreset = {
  id: string;
  label: string;
  type: LeadStructuredActivityType;
  summary: string;
  note: string;
  syncFollowUp: boolean;
};

export type NextBestActionSuggestion = {
  id: string;
  title: string;
  detail: string;
  target: "activities" | "status" | "tasks" | "documents";
};

const COMMUNICATION_TEMPLATES: CommunicationTemplate[] = [
  {
    id: "wa_intro",
    channel: "whatsapp",
    label: "Intro and qualification",
    activityType: "call_connected",
    body:
      "Hi {{firstName}}, this is {{ownerName}} from People. Sharing the details for {{programLabel}}. Let me know a good time for a quick call today.",
  },
  {
    id: "wa_callback",
    channel: "whatsapp",
    label: "Callback confirmation",
    activityType: "call_connected",
    body:
      "Hi {{firstName}}, as discussed, I will call you back regarding {{programLabel}}. Please reply with a suitable time window today.",
  },
  {
    id: "wa_payment",
    channel: "whatsapp",
    label: "Payment follow-up",
    activityType: "payment_reminder",
    body:
      "Hi {{firstName}}, this is a reminder for the next payment step for {{programLabel}}. Please share your update so we can move your application ahead.",
  },
  {
    id: "email_docs",
    channel: "email",
    label: "Document checklist",
    activityType: "docs_requested",
    subject: "Documents required for {{programLabel}}",
    body:
      "Hi {{firstName}},\n\nPlease share the pending documents for {{programLabel}} so we can move your application forward.\n\nRegards,\n{{ownerName}}",
  },
  {
    id: "email_fee",
    channel: "email",
    label: "Fee and payment summary",
    activityType: "fee_discussed",
    subject: "Fee details for {{programLabel}}",
    body:
      "Hi {{firstName}},\n\nSharing the fee discussion summary for {{programLabel}}. Reply here if you want us to walk through the payment options again.\n\nRegards,\n{{ownerName}}",
  },
];

export function getCommunicationTemplates(channel: CommunicationChannel) {
  return COMMUNICATION_TEMPLATES.filter((template) => template.channel === channel);
}

function getLeadFirstName(lead: LeadDoc) {
  return lead.name?.trim().split(/\s+/)[0] ?? "there";
}

function getProgramLabel(lead: LeadDoc) {
  return (
    [lead.enrollmentDetails?.course, lead.targetDegree, lead.enrollmentDetails?.university, lead.targetUniversity]
      .filter(Boolean)
      .join(" | ") || "your program"
  );
}

export function fillCommunicationTemplate(
  template: CommunicationTemplate,
  input: {
    lead: LeadDoc;
    ownerName: string;
  },
) {
  const replacements: Record<string, string> = {
    "{{firstName}}": getLeadFirstName(input.lead),
    "{{ownerName}}": input.ownerName,
    "{{programLabel}}": getProgramLabel(input.lead),
  };

  const apply = (value?: string) =>
    Object.entries(replacements).reduce(
      (current, [key, replacement]) => current.replaceAll(key, replacement),
      value ?? "",
    );

  return {
    subject: apply(template.subject),
    body: apply(template.body),
  };
}

export function getCommunicationOutcomePresets(lead: LeadDoc): CommunicationOutcomePreset[] {
  const status = normalizeLeadStatus(lead.status);

  return [
    {
      id: "connected_now",
      label: "Connected",
      type: "call_connected",
      summary: "Lead connected on call",
      note: "Meaningful conversation completed and next step discussed.",
      syncFollowUp: status === "followup" || status === "new",
    },
    {
      id: "callback_promised",
      label: "Callback",
      type: "call_connected",
      summary: "Callback promised",
      note: "Lead asked for a callback window.",
      syncFollowUp: true,
    },
    {
      id: "no_connect",
      label: "No Connect",
      type: "call_not_connected",
      summary: "Attempted but lead did not connect",
      note: "No answer or call could not be completed.",
      syncFollowUp: false,
    },
    {
      id: "docs_needed",
      label: "Docs Requested",
      type: "docs_requested",
      summary: "Documents requested from lead",
      note: "Asked the lead to share pending documents.",
      syncFollowUp: true,
    },
    {
      id: "payment_nudge",
      label: "Payment Reminder",
      type: "payment_reminder",
      summary: "Payment reminder sent",
      note: "Shared the payment reminder and next action.",
      syncFollowUp: isPaymentFollowUpStatus(lead.status),
    },
  ];
}

export function getNextBestActionSuggestions(input: {
  lead: LeadDoc;
  activities: LeadActivityDoc[];
  tasks: LeadCommandTaskDoc[];
}) {
  const suggestions: NextBestActionSuggestion[] = [];
  const latestActivity = input.activities[0] ?? null;
  const openTasks = input.tasks.filter((task) => task.status !== "completed");
  const hasDueFollowUp = Boolean(input.lead.nextFollowUpDateKey);
  const status = normalizeLeadStatus(input.lead.status);

  if (!latestActivity) {
    suggestions.push({
      id: "first_touch",
      title: "Log the first touch",
      detail: "Capture the first connected call or attempted outreach from Activities.",
      target: "activities",
    });
  }

  if ((status === "new" || status === "followup") && !hasDueFollowUp) {
    suggestions.push({
      id: "set_followup",
      title: "Set the next follow-up",
      detail: "This lead does not have a committed next step yet.",
      target: "status",
    });
  }

  if (openTasks.length === 0 && !isPaymentFollowUpStatus(input.lead.status)) {
    suggestions.push({
      id: "create_task",
      title: "Create the next action task",
      detail: "There is no open linked task carrying the next action.",
      target: "tasks",
    });
  }

  if (isPaymentFollowUpStatus(input.lead.status)) {
    suggestions.push({
      id: "payment_follow_up",
      title: "Send a payment chase",
      detail: `Lead is in ${getLeadStatusLabel(input.lead.status)}. Use the Communication Center to send a structured reminder.`,
      target: "activities",
    });
  }

  if (!input.lead.targetUniversity && !input.lead.enrollmentDetails?.university) {
    suggestions.push({
      id: "capture_program",
      title: "Capture program details",
      detail: "Program and university details are still incomplete.",
      target: "documents",
    });
  }

  return suggestions.slice(0, 3);
}
