"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import {
  ArrowTopRightOnSquareIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  CheckBadgeIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  PencilSquareIcon,
  PhoneIcon,
  UserGroupIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { LockClosedIcon } from "@heroicons/react/24/solid";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { getAllActiveUsers, getUserDoc } from "@/lib/firebase/users";
import {
  createLeadCommandDocument,
  createLeadCommandNote,
  createLeadCommandTask,
  type LeadCommandTaskDoc,
} from "@/lib/crm/command-center";
import {
  createLeadStructuredActivity,
  getLeadActivityTypeLabel,
  LEAD_ACTIVITY_TYPE_OPTIONS,
  mapStatusReasonToActivityType,
} from "@/lib/crm/activities";
import {
  fillCommunicationTemplate,
  getCommunicationOutcomePresets,
  getCommunicationTemplates,
  getNextBestActionSuggestions,
} from "@/lib/crm/communications";
import {
  buildLeadTransferTimeline,
  getLeadCustodyState,
  transferLeadCustody,
} from "@/lib/crm/custody";
import { getLeadOverdueDays, getLeadSlaBucket } from "@/lib/crm/automation";
import { syncLeadWorkflowAutomation } from "@/lib/crm/automation-client";
import {
  canEditLeadProfile,
  canManageLeadAssignment,
  canReassignLead,
  getAssignableLeadOwners,
} from "@/lib/crm/access";
import { getPrimaryRole } from "@/lib/access";
import { applyLeadMutation, buildLeadActor, buildLeadHistoryEntry } from "@/lib/crm/timeline";
import { syncLeadLinkedTasks } from "@/lib/tasks/lead-links";
import { normalizeTaskDoc } from "@/lib/tasks/model";
import {
  getLeadStatusLabel,
  isFollowUpStatus,
  isPaymentFollowUpStatus,
  normalizeLeadStatus,
  PAYMENT_FOLLOW_UP_STATUS,
} from "@/lib/leads/status";
import {
  buildLeadSopDraft,
  DEFAULT_PULLBACK_REASON_TEMPLATE_ID,
  findSopPresetByStageReason,
  getAssignmentReasonTemplate,
  getAssignmentReasonTemplates,
  getLeadSopOutcomePresets,
  SOP_STAGE_CONNECTED,
  SOP_STAGE_NOT_CONNECTED,
  type AssignmentReasonTemplateId,
  type LeadSopOutcomeId,
} from "@/lib/crm/sop";
import {
  getRoleLayoutProfile,
  type CrmCommandSection,
} from "@/lib/layouts/role-layout";
import type {
  LeadActivityDoc,
  LeadCustodyState,
  LeadDoc,
  LeadDocumentDoc,
  LeadNoteDoc,
  LeadStructuredActivityType,
  LeadStatus,
  LeadStatusDetail,
  LeadTimelineEvent,
} from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";
import { toTitleCase } from "@/lib/utils/stringUtils";
import { updateLeadClosure } from "@/lib/firebase/leads";
import ClosureForm, { type ClosureFormData } from "./ClosureForm";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  lead: LeadDoc | null;
  currentUser: UserDoc;
  userRole?: string;
  initialSection?: CrmCommandSection;
  prefillOutcomeId?: LeadSopOutcomeId | null;
  prefillAssignmentReason?: string | null;
  prefillAssigneeUid?: string | null;
};

const CATEGORY_NOT_CONNECTED = SOP_STAGE_NOT_CONNECTED;
const CATEGORY_CONNECTED = SOP_STAGE_CONNECTED;

const HIERARCHY = {
  [CATEGORY_NOT_CONNECTED]: {
    type: "direct",
    options: ["Invalid Number", "No Incoming", "Wrong Number", "Switched Off", "Out of Network"],
  },
  [CATEGORY_CONNECTED]: {
    type: "nested",
    options: [
      { label: "Ringing", type: "leaf" },
      { label: "Asked to Call Back", type: "leaf" },
      { label: "Not Interested", type: "leaf" },
      { label: "Not Eligible", type: "leaf" },
      { label: "Interested for Next Session", type: "leaf" },
      {
        label: "Product Details Explained (Escalated Call)",
        type: "group",
        options: ["Product Pitched", "Demo Done", "Demo Done - Not Interested"],
      },
      {
        label: "Payment Follow Up (Registration Done)",
        type: "group",
        options: [
          "Payment Follow Up",
          "Application Fees Paid",
          "Loan Initiated",
          "Education & Works",
          "Enrollment Generated",
          "UTR Details (Loan Details)",
        ],
      },
    ],
  },
} as const;

const STATUS_MAPPING: Record<string, LeadStatus> = {
  "Invalid Number": "wrong_number",
  "No Incoming": "followup",
  "Wrong Number": "wrong_number",
  "Switched Off": "followup",
  "Out of Network": "followup",
  Ringing: "ringing",
  "Asked to Call Back": "followup",
  "Not Interested": "not_interested",
  "Not Eligible": "not_interested",
  "Interested for Next Session": "followup",
  "Product Pitched": "followup",
  "Demo Done": "followup",
  "Demo Done - Not Interested": "not_interested",
  "Demo Done-Not Interested": "not_interested",
  "Payment Follow Up": PAYMENT_FOLLOW_UP_STATUS,
  "Application Fees Paid": PAYMENT_FOLLOW_UP_STATUS,
  "Loan Initiated": PAYMENT_FOLLOW_UP_STATUS,
  "Education & Works": PAYMENT_FOLLOW_UP_STATUS,
  "Enrollment Generated": "closed",
  "UTR Details (Loan Details)": PAYMENT_FOLLOW_UP_STATUS,
  "UTR (Loan Details)": PAYMENT_FOLLOW_UP_STATUS,
};

function toDate(ts: unknown): Date {
  if (!ts) return new Date(0);
  if (ts instanceof Date) return ts;
  if (typeof ts === "object" && "toDate" in ts && typeof (ts as { toDate: unknown }).toDate === "function") {
    return (ts as { toDate: () => Date }).toDate();
  }
  if (typeof ts === "object" && "seconds" in ts && typeof (ts as { seconds: unknown }).seconds === "number") {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  return new Date(ts as string | number);
}

function formatDateTime(ts: unknown) {
  if (!ts) return "-";
  return toDate(ts).toLocaleString();
}

function formatDateInput(ts: unknown) {
  if (!ts) return "";
  const d = toDate(ts);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function parseLeadTags(raw: string) {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => toTitleCase(value)),
    ),
  );
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sectionId(section: CrmCommandSection) {
  return `lead-command-${section}`;
}

const SECTION_LABELS: Record<CrmCommandSection, string> = {
  summary: "Summary",
  assignment: "Assignment",
  activities: "Activities",
  tasks: "Tasks",
  notes: "Notes",
  documents: "Documents",
  status: "Stage Outcome",
  audit: "Audit",
};

const SECTION_PRIORITY: CrmCommandSection[] = [
  "activities",
  "status",
  "tasks",
  "summary",
  "assignment",
  "notes",
  "documents",
  "audit",
];

function getSectionLabel(section: CrmCommandSection) {
  return SECTION_LABELS[section] ?? section.replace("_", " ");
}

function orderSections(sections: CrmCommandSection[]) {
  const rank = new Map(SECTION_PRIORITY.map((section, index) => [section, index]));
  return [...sections].sort((left, right) => {
    const leftRank = rank.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.localeCompare(right);
  });
}

function sectionCard(active: boolean) {
  return `min-w-0 overflow-hidden rounded-[26px] border p-5 transition ${active ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200 bg-white"}`;
}

function getPhoneHref(phone: string | null | undefined) {
  return phone ? `tel:${phone}` : "#";
}

function getWhatsappHref(phone: string | null | undefined) {
  const normalized = phone?.replace(/\D/g, "") ?? "";
  return normalized ? `https://wa.me/${normalized}` : "#";
}

function getMailtoHref(email: string | null | undefined, subject: string, body: string) {
  if (!email) return "#";
  const query = new URLSearchParams({
    subject,
    body,
  });
  return `mailto:${email}?${query.toString()}`;
}

function activityTone(type: LeadStructuredActivityType) {
  switch (type) {
    case "payment_reminder":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "demo_done":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "docs_requested":
    case "docs_received":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "parent_call":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "fee_discussed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "call_not_connected":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "call_connected":
    default:
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
  }
}

export default function LeadDetailPanel({
  isOpen,
  onClose,
  lead,
  currentUser,
  userRole,
  initialSection = "summary",
  prefillOutcomeId = null,
  prefillAssignmentReason = null,
  prefillAssigneeUid = null,
}: Props) {
  const crmLayout = useMemo(() => getRoleLayoutProfile(currentUser).crm, [currentUser]);
  const visibleSections = crmLayout.visibleSections;
  const primaryRole = useMemo(() => getPrimaryRole(currentUser), [currentUser]);
  const supportsExecutionMode =
    primaryRole === "BDA_TRAINEE" ||
    primaryRole === "BDA" ||
    primaryRole === "BDM_TRAINING" ||
    primaryRole === "MANAGER" ||
    primaryRole === "SENIOR_MANAGER" ||
    primaryRole === "GM" ||
    primaryRole === "AVP" ||
    primaryRole === "VP" ||
    primaryRole === "SALES_HEAD" ||
    primaryRole === "CBO" ||
    primaryRole === "CEO";
  const actor = useMemo(
    () => buildLeadActor({
      uid: currentUser.uid,
      displayName: currentUser.displayName,
      email: currentUser.email,
      role: currentUser.role,
      orgRole: currentUser.orgRole ?? userRole ?? null,
      employeeId: currentUser.employeeId ?? null,
    }),
    [currentUser, userRole],
  );
  const canOverrideStatusLock = canReassignLead(currentUser);
  const canManageAssignment = canManageLeadAssignment(currentUser);
  const canEditDetails = canEditLeadProfile(currentUser);

  const [liveLead, setLiveLead] = useState<LeadDoc | null>(lead);
  const currentLead = (liveLead ?? lead)!;
  const [allActiveUsers, setAllActiveUsers] = useState<UserDoc[]>([]);
  const [timelineEntries, setTimelineEntries] = useState<LeadTimelineEvent[]>([]);
  const [transferTimelineEntries, setTransferTimelineEntries] = useState<LeadTimelineEvent[]>([]);
  const [leadActivities, setLeadActivities] = useState<LeadActivityDoc[]>([]);
  const [leadNotes, setLeadNotes] = useState<LeadNoteDoc[]>([]);
  const [leadDocuments, setLeadDocuments] = useState<LeadDocumentDoc[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<LeadCommandTaskDoc[]>([]);
  const [activeSection, setActiveSection] = useState<CrmCommandSection>(initialSection);
  const [simpleExecutionMode, setSimpleExecutionMode] = useState(false);
  const [status, setStatus] = useState<LeadStatus>("new");
  const [stage, setStage] = useState("");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [closerName, setCloserName] = useState("-");
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [transferHistoryQuery, setTransferHistoryQuery] = useState("");
  const [transferHistoryStateFilter, setTransferHistoryStateFilter] =
    useState<LeadCustodyState | "all">("all");
  const [transferHistoryActorFilter, setTransferHistoryActorFilter] = useState("all");
  const [resetStatusOnReassign, setResetStatusOnReassign] = useState(!canOverrideStatusLock);
  const [reassignOpenTasks, setReassignOpenTasks] = useState(true);
  const [refundReason, setRefundReason] = useState("admission_cancelled");
  const [refundAmount, setRefundAmount] = useState("");
  const [statusFollowUpAt, setStatusFollowUpAt] = useState("");
  const [statusAssistMessage, setStatusAssistMessage] = useState<string | null>(null);
  const [statusRemarksTouched, setStatusRemarksTouched] = useState(false);
  const [statusFollowUpTouched, setStatusFollowUpTouched] = useState(false);
  const [lastOutcomePrefillKey, setLastOutcomePrefillKey] = useState<string | null>(null);
  const [lastAssignmentPrefillKey, setLastAssignmentPrefillKey] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [refundSaving, setRefundSaving] = useState(false);
  const [activitySaving, setActivitySaving] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);
  const [activityForm, setActivityForm] = useState({
    type: "call_connected" as LeadStructuredActivityType,
    summary: "",
    note: "",
    happenedAt: formatDateInput(new Date()),
    followUpAt: "",
    syncFollowUp: false,
  });
  const [selectedWhatsappTemplateId, setSelectedWhatsappTemplateId] = useState("wa_intro");
  const [selectedEmailTemplateId, setSelectedEmailTemplateId] = useState("email_docs");
  const [communicationNote, setCommunicationNote] = useState("");
  const [communicationSaving, setCommunicationSaving] = useState(false);
  const [documentForm, setDocumentForm] = useState({ title: "", url: "", category: "", note: "" });
  const [formData, setFormData] = useState({
    education: "",
    university: "",
    location: "",
    language: "",
    aadhar: "",
    pan: "",
    address: "",
  });
  const [leadTagsInput, setLeadTagsInput] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", description: "", assigneeUid: currentUser.uid, priority: "medium" as "high" | "medium" | "low", deadline: "" });
  const parsedLeadTags = useMemo(() => parseLeadTags(leadTagsInput), [leadTagsInput]);

  const userDirectory = useMemo(() => {
    const entries = new Map<string, UserDoc>();
    allActiveUsers.forEach((user) => entries.set(user.uid, user));
    entries.set(currentUser.uid, currentUser);
    return entries;
  }, [allActiveUsers, currentUser]);

  const assignableUsers = useMemo(() => getAssignableLeadOwners(currentUser, allActiveUsers), [allActiveUsers, currentUser]);

  const taskAssignees = useMemo(() => {
    const candidates = canManageAssignment ? [...assignableUsers, currentUser] : [currentUser];
    const unique = new Map<string, UserDoc>();
    candidates.forEach((candidate) => unique.set(candidate.uid, candidate));
    if (currentLead?.assignedTo && userDirectory.has(currentLead.assignedTo)) {
      unique.set(currentLead.assignedTo, userDirectory.get(currentLead.assignedTo)!);
    }
    return Array.from(unique.values());
  }, [assignableUsers, canManageAssignment, currentLead?.assignedTo, currentUser, userDirectory]);

  const whatsappTemplates = useMemo(() => getCommunicationTemplates("whatsapp"), []);
  const emailTemplates = useMemo(() => getCommunicationTemplates("email"), []);
  const selectedWhatsappTemplate = useMemo(
    () => whatsappTemplates.find((template) => template.id === selectedWhatsappTemplateId) ?? whatsappTemplates[0] ?? null,
    [selectedWhatsappTemplateId, whatsappTemplates],
  );
  const selectedEmailTemplate = useMemo(
    () => emailTemplates.find((template) => template.id === selectedEmailTemplateId) ?? emailTemplates[0] ?? null,
    [emailTemplates, selectedEmailTemplateId],
  );
  const ownerLabel = useMemo(() => {
    const ownerUid = currentLead?.assignedTo ?? currentLead?.ownerUid ?? null;
    if (ownerUid && userDirectory.has(ownerUid)) {
      const owner = userDirectory.get(ownerUid)!;
      return owner.displayName ?? owner.email ?? owner.uid;
    }
    return currentUser.displayName ?? currentUser.email ?? currentUser.uid;
  }, [currentLead, currentUser.displayName, currentUser.email, currentUser.uid, userDirectory]);
  const filledWhatsappTemplate = useMemo(
    () =>
      currentLead && selectedWhatsappTemplate
        ? fillCommunicationTemplate(selectedWhatsappTemplate, { lead: currentLead, ownerName: ownerLabel })
        : { subject: "", body: "" },
    [currentLead, ownerLabel, selectedWhatsappTemplate],
  );
  const filledEmailTemplate = useMemo(
    () =>
      currentLead && selectedEmailTemplate
        ? fillCommunicationTemplate(selectedEmailTemplate, { lead: currentLead, ownerName: ownerLabel })
        : { subject: "", body: "" },
    [currentLead, ownerLabel, selectedEmailTemplate],
  );
  const communicationPresets = useMemo(
    () => (currentLead ? getCommunicationOutcomePresets(currentLead) : []),
    [currentLead],
  );
  const statusSopOutcomes = useMemo(
    () => (currentLead ? getLeadSopOutcomePresets(currentLead) : []),
    [currentLead],
  );
  const assignmentReasonTemplates = useMemo(
    () => getAssignmentReasonTemplates(),
    [],
  );
  const nextBestActions = useMemo(
    () =>
      currentLead
        ? getNextBestActionSuggestions({
            lead: currentLead,
            activities: leadActivities,
            tasks: linkedTasks,
          })
        : [],
    [currentLead, leadActivities, linkedTasks],
  );
  const leadSlaMeta = useMemo(() => {
    if (!currentLead) return null;
    const todayKey = toDateKey(new Date());
    const bucket = getLeadSlaBucket(currentLead, todayKey);
    if (bucket === "overdue") {
      const overdueDays = Math.max(1, getLeadOverdueDays(currentLead, todayKey));
      return {
        bucket: "overdue" as const,
        label: overdueDays === 1 ? "SLA overdue by 1 day" : `SLA overdue by ${overdueDays} days`,
        toneClass: "border border-rose-200 bg-rose-50 text-rose-700",
      };
    }
    if (bucket === "due_today") {
      return {
        bucket: "due_today" as const,
        label: "SLA due today",
        toneClass: "border border-amber-200 bg-amber-50 text-amber-700",
      };
    }
    return null;
  }, [currentLead]);

  const isLeadLocked = useMemo(() => {
    if (!currentLead) return false;
    return normalizeLeadStatus(currentLead.status) === "closed" || (
      isPaymentFollowUpStatus(currentLead.status) && (
        currentLead.subStatus === "Enrollment Generated" ||
        currentLead.subStatus === "UTR (Loan Details)" ||
        currentLead.subStatus === "UTR Details (Loan Details)" ||
        currentLead.statusDetail?.currentReason === "Enrollment Generated" ||
        currentLead.statusDetail?.currentReason === "UTR (Loan Details)" ||
        currentLead.statusDetail?.currentReason === "UTR Details (Loan Details)" ||
        !!currentLead.enrollmentDetails
      )
    );
  }, [currentLead]);
  const currentCustodyState = useMemo(
    () => (currentLead ? getLeadCustodyState(currentLead) : "owned"),
    [currentLead],
  );
  const transferHistoryRows = useMemo(() => {
    return buildLeadTransferTimeline({
      transferHistory: currentLead?.transferHistory,
      lastTransfer: currentLead?.lastTransfer ?? null,
      timelineEvents: transferTimelineEntries,
    });
  }, [currentLead?.lastTransfer, currentLead?.transferHistory, transferTimelineEntries]);
  const transferHistoryActors = useMemo(() => {
    const actors = new Map<string, string>();
    transferHistoryRows.forEach((entry) => {
      const actorUid = entry.transferredBy?.uid ?? "";
      if (!actorUid) return;
      actors.set(actorUid, entry.transferredBy?.name || actorUid);
    });
    return Array.from(actors.entries())
      .map(([uid, name]) => ({ uid, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [transferHistoryRows]);
  const filteredTransferHistoryRows = useMemo(() => {
    const term = transferHistoryQuery.trim().toLowerCase();
    return transferHistoryRows.filter((entry) => {
      if (transferHistoryStateFilter !== "all" && entry.custodyState !== transferHistoryStateFilter) {
        return false;
      }
      if (
        transferHistoryActorFilter !== "all" &&
        (entry.transferredBy?.uid ?? "") !== transferHistoryActorFilter
      ) {
        return false;
      }
      if (!term) return true;
      return (
        [
          entry.reason,
          entry.previousOwnerName,
          entry.currentOwnerName,
          entry.previousOwnerUid,
          entry.currentOwnerUid,
          entry.transferredBy?.name,
          entry.transferredBy?.uid,
          entry.custodyState,
          entry.id,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term))
      );
    });
  }, [
    transferHistoryActorFilter,
    transferHistoryQuery,
    transferHistoryRows,
    transferHistoryStateFilter,
  ]);

  const canEditStatus = canOverrideStatusLock || !isLeadLocked;
  const canSaveStatusNow = !statusSaving && canEditStatus && !!stage && !!reason;
  const canSaveDetailsNow = canEditDetails && !detailsSaving;
  const canSaveAssignmentNow =
    !assignmentSaving &&
    !!selectedAssignee &&
    !!assignmentReason.trim() &&
    selectedAssignee !== (currentLead?.assignedTo ?? currentLead?.ownerUid ?? "");
  const canSaveTaskNow = !taskSaving && !!taskForm.title.trim() && !!taskForm.assigneeUid;
  const canSaveActivityNow =
    !activitySaving &&
    !!activityForm.happenedAt &&
    (!activityForm.syncFollowUp || !!activityForm.followUpAt);
  const canSaveNoteNow = !noteSaving && !!noteBody.trim();
  const canSaveDocumentNow =
    !documentSaving &&
    !!documentForm.title.trim() &&
    !!documentForm.url.trim() &&
    !!documentForm.category.trim();
  const executionSections = useMemo(() => {
    const target: CrmCommandSection[] = ["status", "tasks"];
    if (canManageAssignment && (initialSection === "assignment" || !!prefillAssigneeUid || !!prefillAssignmentReason)) {
      target.push("assignment");
    }
    const scoped = target.filter((section) => visibleSections.includes(section));
    return scoped.length > 0 ? scoped : visibleSections;
  }, [
    canManageAssignment,
    initialSection,
    prefillAssigneeUid,
    prefillAssignmentReason,
    visibleSections,
  ]);
  const scopedSections = simpleExecutionMode ? executionSections : visibleSections;
  const showSection = (section: CrmCommandSection) => scopedSections.includes(section);
  const orderedScopedSections = useMemo(
    () => orderSections(scopedSections),
    [scopedSections],
  );
  const topExecutionSections = useMemo(
    () =>
      ["activities", "status", "tasks"].filter((section) =>
        orderedScopedSections.includes(section as CrmCommandSection),
      ) as CrmCommandSection[],
    [orderedScopedSections],
  );
  const quickActionSections = useMemo(
    () =>
      ["activities", "status", "tasks", "summary"].filter((section) =>
        orderedScopedSections.includes(section as CrmCommandSection),
      ) as CrmCommandSection[],
    [orderedScopedSections],
  );

  useEffect(() => {
    setLiveLead(lead);
  }, [lead]);

  useEffect(() => {
    if (!db || !lead?.leadId || !isOpen) return undefined;
    return onSnapshot(doc(db, "leads", lead.leadId), (snapshot) => {
      if (snapshot.exists()) {
        setLiveLead({ ...(snapshot.data() as LeadDoc), leadId: snapshot.id });
      }
    });
  }, [isOpen, lead?.leadId]);

  useEffect(() => {
    if (!isOpen) return;
    setSimpleExecutionMode(supportsExecutionMode);
  }, [isOpen, lead?.leadId, supportsExecutionMode]);

  useEffect(() => {
    if (!isOpen) return;
    setActiveSection(
      scopedSections.includes(initialSection)
        ? initialSection
        : scopedSections[0] ?? crmLayout.defaultSection,
    );
  }, [
    crmLayout.defaultSection,
    initialSection,
    isOpen,
    lead?.leadId,
    scopedSections,
  ]);

  useEffect(() => {
    if (!scopedSections.includes(activeSection)) {
      setActiveSection(scopedSections[0] ?? crmLayout.defaultSection);
    }
  }, [activeSection, crmLayout.defaultSection, scopedSections]);

  useEffect(() => {
    if (!isOpen || !supportsExecutionMode) return;
    if (
      initialSection === "assignment" ||
      (!!prefillAssigneeUid && prefillAssigneeUid.trim().length > 0) ||
      (!!prefillAssignmentReason && prefillAssignmentReason.trim().length > 0)
    ) {
      setSimpleExecutionMode(false);
    }
  }, [
    initialSection,
    isOpen,
    prefillAssigneeUid,
    prefillAssignmentReason,
    supportsExecutionMode,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    getAllActiveUsers()
      .then((users) => {
        if (active) setAllActiveUsers(users);
      })
      .catch((error) => {
        console.error("Failed to load active users", error);
        if (active) setAllActiveUsers([]);
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!currentLead) return;

    setStatus(normalizeLeadStatus(currentLead.status));
    setRemarks("");
    setStatusAssistMessage(null);
    setStatusRemarksTouched(false);
    setStatusFollowUpTouched(false);
    setLastOutcomePrefillKey(null);
    setLastAssignmentPrefillKey(null);

    const currentStage = currentLead.statusDetail?.currentStage;
    const currentReason = currentLead.statusDetail?.currentReason;
    if (currentStage === CATEGORY_NOT_CONNECTED) {
      setActiveCategory(CATEGORY_NOT_CONNECTED);
      setStage(currentStage);
      setReason(currentReason || "");
    } else if (currentStage === "Product Details Explained (Escalated Call)" || currentStage === "Payment Follow Up (Registration Done)") {
      setActiveCategory(CATEGORY_CONNECTED);
      setStage(currentStage);
      setReason(currentReason || "");
    } else {
      setActiveCategory(isPaymentFollowUpStatus(currentLead.status) || normalizeLeadStatus(currentLead.status) === "closed" ? CATEGORY_CONNECTED : "");
      setStage(currentStage || "");
      setReason(currentReason || "");
    }

    setFormData({
      education: currentLead.currentEducation ?? "",
      university: currentLead.targetUniversity ?? "",
      location: currentLead.leadLocation ?? "",
      language: currentLead.preferredLanguage ?? "",
      aadhar: currentLead.kycData?.aadhar ?? "",
      pan: currentLead.kycData?.pan ?? "",
      address: currentLead.kycData?.address ?? "",
    });
    setLeadTagsInput((currentLead.leadTags ?? []).join(", "));
    setSelectedAssignee(currentLead.assignedTo ?? currentLead.ownerUid ?? "");
    setAssignmentReason("");
    setTransferHistoryQuery("");
    setTransferHistoryStateFilter("all");
    setTransferHistoryActorFilter("all");
    setReassignOpenTasks(true);
    setTaskForm({
      title: `Follow up with ${toTitleCase(currentLead.name)}`,
      description: currentLead.remarks ?? "",
      assigneeUid: currentLead.assignedTo ?? currentLead.ownerUid ?? currentUser.uid,
      priority: isPaymentFollowUpStatus(currentLead.status) ? "high" : "medium",
      deadline: formatDateInput(currentLead.nextFollowUp ?? null),
    });
    setStatusFollowUpAt(formatDateInput(currentLead.nextFollowUp ?? null));
    setActivityForm({
      type: isPaymentFollowUpStatus(currentLead.status) ? "payment_reminder" : "call_connected",
      summary: "",
      note: "",
      happenedAt: formatDateInput(new Date()),
      followUpAt: formatDateInput(currentLead.nextFollowUp ?? null),
      syncFollowUp: false,
    });
    setSelectedWhatsappTemplateId(
      isPaymentFollowUpStatus(currentLead.status) ? "wa_payment" : "wa_intro",
    );
    setSelectedEmailTemplateId(
      isPaymentFollowUpStatus(currentLead.status) ? "email_fee" : "email_docs",
    );
    setCommunicationNote("");
  }, [currentLead, currentUser.uid]);

  useEffect(() => {
    if (!isOpen || !currentLead || !prefillOutcomeId) return;
    const nextKey = `${currentLead.leadId}:${prefillOutcomeId}`;
    if (lastOutcomePrefillKey === nextKey) return;
    const draft = buildLeadSopDraft({
      lead: currentLead,
      outcomeId: prefillOutcomeId,
      actorName: actor.name,
    });
    setActiveSection("status");
    setActiveCategory(
      draft.stage === CATEGORY_NOT_CONNECTED
        ? CATEGORY_NOT_CONNECTED
        : CATEGORY_CONNECTED,
    );
    setStage(draft.stage);
    setReason(draft.reason);
    setStatus(draft.status);
    setRemarks(draft.remarks);
    setStatusFollowUpAt(draft.followUpAt ? formatDateInput(draft.followUpAt) : "");
    setStatusAssistMessage(`${draft.preset.label} SOP template loaded.`);
    setStatusRemarksTouched(false);
    setStatusFollowUpTouched(false);
    setLastOutcomePrefillKey(nextKey);
  }, [actor.name, currentLead, isOpen, lastOutcomePrefillKey, prefillOutcomeId]);

  useEffect(() => {
    if (!isOpen || !currentLead) return;
    const nextKey = `${currentLead.leadId}:${prefillAssigneeUid ?? ""}:${prefillAssignmentReason ?? ""}`;
    if (lastAssignmentPrefillKey === nextKey) return;
    if (prefillAssignmentReason?.trim()) {
      setAssignmentReason(prefillAssignmentReason.trim());
    }
    if (prefillAssigneeUid?.trim()) {
      setSelectedAssignee(prefillAssigneeUid.trim());
    }
    setLastAssignmentPrefillKey(nextKey);
  }, [
    currentLead,
    isOpen,
    lastAssignmentPrefillKey,
    prefillAssigneeUid,
    prefillAssignmentReason,
  ]);

  useEffect(() => {
    if (!currentLead) return;
    let mounted = true;
    const history = currentLead.history || [];
    const closureEntry = [...history].reverse().find(
      (entry) =>
        (isPaymentFollowUpStatus(entry.newStatus) || normalizeLeadStatus(entry.newStatus) === "closed") &&
        (entry.remarks?.toLowerCase().includes("enrollment") || entry.remarks?.toLowerCase().includes("utr") || entry.remarks?.includes("Registration Done")),
    );

    if (currentLead.closedBy?.name) {
      setCloserName(currentLead.closedBy.name);
      return;
    }
    if (closureEntry?.updatedByName && closureEntry.updatedByName !== "Agent") {
      setCloserName(closureEntry.updatedByName);
      return;
    }
    if (closureEntry?.updatedBy) {
      getUserDoc(closureEntry.updatedBy)
        .then((user) => {
          if (mounted && user?.displayName) setCloserName(user.displayName);
        })
        .catch((error) => console.error("Failed to load closer", error));
    }
    return () => {
      mounted = false;
    };
  }, [currentLead]);

  useEffect(() => {
    if (!db || !currentLead?.leadId || !isOpen) {
      setTimelineEntries([]);
      setTransferTimelineEntries([]);
      setLeadActivities([]);
      setLeadNotes([]);
      setLeadDocuments([]);
      setLinkedTasks([]);
      return undefined;
    }

    const unsubs = [
      onSnapshot(
        query(collection(db, "leads", currentLead.leadId, "timeline"), orderBy("createdAt", "desc")),
        (snapshot) => {
          const rows = snapshot.docs.map((entry) => ({
            ...(entry.data() as Omit<LeadTimelineEvent, "id">),
            id: entry.id,
          }));
          setTimelineEntries(rows.slice(0, 120));
          setTransferTimelineEntries(rows.filter((entry) => entry.type === "reassigned"));
        },
        (error) => {
          console.error("Failed to load lead timeline", error);
          setTimelineEntries([]);
          setTransferTimelineEntries([]);
        },
      ),
      onSnapshot(
        query(collection(db, "leads", currentLead.leadId, "activities"), orderBy("happenedAt", "desc"), limit(20)),
        (snapshot) => setLeadActivities(snapshot.docs.map((entry) => ({ ...(entry.data() as Omit<LeadActivityDoc, "id">), id: entry.id }))),
        (error) => {
          console.error("Failed to load lead activities", error);
          setLeadActivities([]);
        },
      ),
      onSnapshot(
        query(collection(db, "leads", currentLead.leadId, "notes"), orderBy("createdAt", "desc"), limit(20)),
        (snapshot) => setLeadNotes(snapshot.docs.map((note) => ({ ...(note.data() as Omit<LeadNoteDoc, "id">), id: note.id }))),
        (error) => {
          console.error("Failed to load lead notes", error);
          setLeadNotes([]);
        },
      ),
      onSnapshot(
        query(collection(db, "leads", currentLead.leadId, "documents"), orderBy("createdAt", "desc"), limit(20)),
        (snapshot) => setLeadDocuments(snapshot.docs.map((item) => ({ ...(item.data() as Omit<LeadDocumentDoc, "id">), id: item.id }))),
        (error) => {
          console.error("Failed to load lead documents", error);
          setLeadDocuments([]);
        },
      ),
      onSnapshot(
        query(collection(db, "tasks"), where("leadId", "==", currentLead.leadId), limit(40)),
        (snapshot) => {
          const rows = snapshot.docs.map((taskDoc) => normalizeTaskDoc(taskDoc.data() as Record<string, unknown>, taskDoc.id)) as LeadCommandTaskDoc[];
          rows.sort((left, right) => {
            const leftDate = left.deadline ? toDate(left.deadline).getTime() : toDate(left.createdAt).getTime();
            const rightDate = right.deadline ? toDate(right.deadline).getTime() : toDate(right.createdAt).getTime();
            return leftDate - rightDate;
          });
          setLinkedTasks(rows);
        },
        (error) => {
          console.error("Failed to load linked tasks", error);
          setLinkedTasks([]);
        },
      ),
    ];

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [currentLead?.leadId, isOpen]);

  useEffect(() => {
    if (!isOpen || !currentLead) return;

    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName;
      return (
        target.isContentEditable ||
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT"
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const index = Number.parseInt(event.key, 10) - 1;
        if (!Number.isNaN(index) && index >= 0 && index < scopedSections.length) {
          event.preventDefault();
          jumpTo(scopedSections[index]);
          return;
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        handlePrimarySectionAction();
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "l" && !isEditableTarget(event.target)) {
        event.preventDefault();
        void navigator.clipboard.writeText(currentLead.leadId);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentLead,
    isOpen,
    scopedSections,
    activeSection,
    canSaveStatusNow,
    canSaveActivityNow,
    canSaveTaskNow,
    canSaveNoteNow,
    canSaveDocumentNow,
    canSaveAssignmentNow,
    canSaveDetailsNow,
    canEditDetails,
  ]);

  if (!currentLead) return null;

  const assignmentLabel =
    userDirectory.get(currentLead.assignedTo ?? currentLead.ownerUid ?? "")?.displayName ??
    userDirectory.get(currentLead.assignedTo ?? currentLead.ownerUid ?? "")?.email ??
    currentLead.assignedTo ??
    currentLead.ownerUid ??
    "Unassigned";
  const showClosureForm = stage === "Payment Follow Up (Registration Done)" && (reason === "Enrollment Generated" || reason === "UTR Details (Loan Details)" || reason === "UTR (Loan Details)");
  const enrollmentVisible = isPaymentFollowUpStatus(currentLead.status) && (currentLead.subStatus === "Enrollment Generated" || currentLead.subStatus === "UTR (Loan Details)" || currentLead.subStatus === "UTR Details (Loan Details)" || !!currentLead.enrollmentDetails);
  const activeHierarchy = activeCategory && activeCategory in HIERARCHY ? HIERARCHY[activeCategory as keyof typeof HIERARCHY] : null;
  const openLinkedTaskCount = linkedTasks.filter((task) => task.status !== "completed").length;
  const leadOwnerUid = currentLead.assignedTo ?? currentLead.ownerUid ?? null;
  const ownerDriftTaskCount = linkedTasks.filter((task) => task.status !== "completed" && (task.assignedTo ?? task.assigneeUid ?? null) !== leadOwnerUid).length;

  function jumpTo(section: CrmCommandSection) {
    if (!showSection(section)) return;
    setActiveSection(section);
    document.getElementById(sectionId(section))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleOptionSelect(reasonLabel: string, stageLabel: string) {
    if (!canEditStatus) return;
    setStage(stageLabel);
    setReason(reasonLabel);
    const mapped = STATUS_MAPPING[reasonLabel];
    if (mapped) setStatus(mapped);

    const sopPreset = findSopPresetByStageReason({
      stage: stageLabel,
      reason: reasonLabel,
    });
    if (!sopPreset || !currentLead) {
      setStatusAssistMessage(null);
      return;
    }

    const draft = buildLeadSopDraft({
      lead: currentLead,
      outcomeId: sopPreset.id,
      actorName: actor.name,
    });

    if (!statusRemarksTouched || !remarks.trim()) {
      setRemarks(draft.remarks);
      setStatusRemarksTouched(false);
    }
    if (draft.followUpAt && (!statusFollowUpTouched || !statusFollowUpAt)) {
      setStatusFollowUpAt(formatDateInput(draft.followUpAt));
      setStatusFollowUpTouched(false);
    }
    setStatusAssistMessage(`${draft.preset.label} SOP template applied.`);
  }

  function applySopOutcome(outcomeId: LeadSopOutcomeId) {
    if (!currentLead || !canEditStatus) return;
    const draft = buildLeadSopDraft({
      lead: currentLead,
      outcomeId,
      actorName: actor.name,
    });
    setActiveCategory(
      draft.stage === CATEGORY_NOT_CONNECTED
        ? CATEGORY_NOT_CONNECTED
        : CATEGORY_CONNECTED,
    );
    setStage(draft.stage);
    setReason(draft.reason);
    setStatus(draft.status);
    setRemarks(draft.remarks);
    setStatusFollowUpAt(draft.followUpAt ? formatDateInput(draft.followUpAt) : "");
    setStatusAssistMessage(`${draft.preset.label} SOP template applied.`);
    setStatusRemarksTouched(false);
    setStatusFollowUpTouched(false);
  }

  function applyAssignmentTemplate(templateId: AssignmentReasonTemplateId) {
    const template = getAssignmentReasonTemplate(templateId);
    setAssignmentReason(template.text);
  }

  async function handleSaveStatus() {
    if (!currentLead.leadId || !stage || !reason) return;
    const requiresFollowUpDate =
      !showClosureForm && (isFollowUpStatus(status) || isPaymentFollowUpStatus(status));
    if (requiresFollowUpDate && !statusFollowUpAt) {
      alert("Select the next follow-up date before saving this outcome.");
      return;
    }

    setStatusSaving(true);
    try {
      const activityType = mapStatusReasonToActivityType({ stage, reason });
      const followUpDate = statusFollowUpAt ? new Date(statusFollowUpAt) : null;
      const nextStatusDetail: LeadStatusDetail = {
        currentStage: stage,
        currentReason: reason,
        lastUpdated: new Date(),
        isLocked: false,
        history: [...(currentLead.statusDetail?.history ?? []), { stage, reason, updatedAt: new Date() }],
      };
      const statusUpdates: Record<string, unknown> = {
        status,
        statusDetail: nextStatusDetail,
        lastContactDateKey: new Date().toISOString().slice(0, 10),
      };
      if (requiresFollowUpDate && followUpDate) {
        statusUpdates.nextFollowUp = followUpDate;
        statusUpdates.nextFollowUpDateKey = followUpDate.toISOString().slice(0, 10);
      } else if (!isFollowUpStatus(status) && !isPaymentFollowUpStatus(status)) {
        statusUpdates.nextFollowUp = null;
        statusUpdates.nextFollowUpDateKey = null;
      }
      await applyLeadMutation({
        leadId: currentLead.leadId,
        actor,
        updates: statusUpdates,
        historyEntry: buildLeadHistoryEntry({ action: "Status Update", actor, oldStatus: String(currentLead.status ?? "unknown"), newStatus: String(status), remarks: remarks || `${stage} - ${reason}` }),
        timeline: { type: "status_updated", summary: `Status moved to ${getLeadStatusLabel(status)}`, metadata: { previousStatus: currentLead.status, nextStatus: status, stage, reason, remarks: remarks || null } },
      });
      await createLeadStructuredActivity({
        leadId: currentLead.leadId,
        actor,
        type: activityType,
        summary: `${stage}: ${reason}`,
        note: remarks || null,
        happenedAt: new Date(),
        followUpAt: followUpDate,
        relatedStatus: String(status),
        metadata: {
          stage,
          reason,
          previousStatus: currentLead.status ?? null,
        },
      });
      await syncLeadLinkedTasks({
        lead: {
          ...currentLead,
          status,
        },
        actorUid: actor.uid,
      });
      await syncLeadWorkflowAutomation({
        lead: {
          ...currentLead,
          status,
          nextFollowUp: followUpDate ?? null,
          nextFollowUpDateKey: followUpDate ? followUpDate.toISOString().slice(0, 10) : null,
        },
        actor,
        status,
        followUpDate,
        remarks,
        stage,
        reason,
        source: "crm_status_automation",
      });
      setRemarks("");
      setStatusFollowUpAt(followUpDate ? formatDateInput(followUpDate) : "");
      setActiveSection("activities");
    } catch (error) {
      console.error("Status update failed", error);
      alert("Failed to update status. Please try again.");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleClosureSubmit(data: ClosureFormData) {
    if (!currentLead.leadId) return;
    setStatusSaving(true);
    try {
      await updateLeadClosure(currentLead.leadId, data, currentUser.uid);
      setActiveSection("summary");
    } catch (error) {
      console.error("Closure failed", error);
      alert("Failed to submit closure details. Please try again.");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleSaveDetails() {
    if (!currentLead.leadId) return;
    setDetailsSaving(true);
    try {
      const normalizedLeadTags = parsedLeadTags.map((tag) => tag.toLowerCase());
      await applyLeadMutation({
        leadId: currentLead.leadId,
        actor,
        updates: {
          currentEducation: formData.education || null,
          targetUniversity: formData.university || null,
          leadLocation: formData.location || null,
          preferredLanguage: formData.language || null,
          "kycData.aadhar": formData.aadhar || null,
          "kycData.pan": formData.pan || null,
          "kycData.address": formData.address || null,
          leadTags: parsedLeadTags.length > 0 ? parsedLeadTags : null,
          leadTagsNormalized:
            normalizedLeadTags.length > 0 ? normalizedLeadTags : null,
        },
        activityEntry: { type: "updated", at: new Date(), note: "KYC details updated" },
        timeline: {
          type: "details_updated",
          summary: "Lead education, location, language, KYC, and tags updated",
          metadata: {
            currentEducation: formData.education || null,
            targetUniversity: formData.university || null,
            leadLocation: formData.location || null,
            preferredLanguage: formData.language || null,
            leadTags: parsedLeadTags.length > 0 ? parsedLeadTags.join(", ") : null,
          },
        },
      });
    } catch (error) {
      console.error("KYC update failed", error);
      alert("Failed to update details. Please try again.");
    } finally {
      setDetailsSaving(false);
    }
  }

  async function handleReassign(nextOwnerUid = selectedAssignee, forcedReason?: string) {
    if (!currentLead.leadId || !nextOwnerUid) return;
    setAssignmentSaving(true);
    try {
      const nextAssignee = userDirectory.get(nextOwnerUid);
      const nextAssigneeName = nextAssignee?.displayName || nextAssignee?.email || nextOwnerUid;
      const previousAssignee = userDirectory.get(currentLead.assignedTo ?? currentLead.ownerUid ?? "");
      const previousAssigneeName = previousAssignee?.displayName || previousAssignee?.email || currentLead.assignedTo || currentLead.ownerUid || "Unassigned";
      const nextStatusDetail = resetStatusOnReassign
        ? {
            currentStage: "",
            currentReason: "",
            lastUpdated: new Date(),
            isLocked: false,
            history: [...(currentLead.statusDetail?.history ?? []), { stage: "Reassigned", reason: "Queue reset", updatedAt: new Date() }],
          }
        : currentLead.statusDetail ?? null;
      const reason =
        forcedReason?.trim() || assignmentReason.trim();
      if (!reason) {
        throw new Error("Transfer reason is required.");
      }

      await transferLeadCustody({
        lead: currentLead,
        actor,
        nextOwnerUid,
        nextOwnerName: nextAssigneeName,
        reason,
        nextStatus: resetStatusOnReassign ? "new" : null,
        nextSubStatus: resetStatusOnReassign ? null : currentLead.subStatus ?? null,
        nextStatusDetail,
        reassignOpenTasks,
        workflowRemarks: reason,
      });
      setAssignmentReason("");
    } catch (error) {
      console.error("Reassignment failed", error);
      alert("Failed to reassign lead.");
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function handleRefund() {
    if (!currentLead.leadId || !refundAmount) return;
    if (!confirm("Are you sure you want to initiate a refund? This will cancel the admission.")) return;
    setRefundSaving(true);
    try {
      const refundLabel = refundReason === "admission_cancelled" ? "Admission Cancelled" : refundReason === "sale_cancelled" ? "Sale Cancelled" : "Refunded";
      await applyLeadMutation({
        leadId: currentLead.leadId,
        actor,
        updates: { status: "closed", "statusDetail.currentStage": "Refund Initiated", "statusDetail.currentReason": refundLabel },
        historyEntry: buildLeadHistoryEntry({ action: "Refund Initiated", actor, oldStatus: String(currentLead.status ?? "unknown"), newStatus: "closed", remarks: `Refund initiated for Rs ${refundAmount}. Reason: ${refundLabel}` }),
        activityEntry: { type: "updated", at: new Date(), note: `Refund initiated for Rs ${refundAmount}` },
        timeline: { type: "refund_initiated", summary: `Refund initiated for Rs ${refundAmount}`, metadata: { previousStatus: currentLead.status, refundAmount, refundReason: refundLabel } },
      });
      setRefundAmount("");
    } catch (error) {
      console.error("Refund failed", error);
      alert("Failed to initiate refund.");
    } finally {
      setRefundSaving(false);
    }
  }

  async function handleCreateTask() {
    if (!currentLead.leadId || !taskForm.title.trim() || !taskForm.assigneeUid) return;
    setTaskSaving(true);
    try {
      await createLeadCommandTask({
        lead: currentLead,
        actor,
        assigneeUid: taskForm.assigneeUid,
        title: taskForm.title,
        description: taskForm.description,
        priority: taskForm.priority,
        deadline: taskForm.deadline ? new Date(taskForm.deadline) : null,
      });
      setTaskForm((previous) => ({ ...previous, description: "", deadline: "" }));
    } catch (error) {
      console.error("Task creation failed", error);
      alert("Failed to create task.");
    } finally {
      setTaskSaving(false);
    }
  }

  async function handleCreateActivity() {
    if (!currentLead.leadId) return;
    setActivitySaving(true);
    try {
      const happenedAt = activityForm.happenedAt ? new Date(activityForm.happenedAt) : new Date();
      const followUpAt = activityForm.followUpAt ? new Date(activityForm.followUpAt) : null;
      await createLeadStructuredActivity({
        leadId: currentLead.leadId,
        actor,
        type: activityForm.type,
        summary: activityForm.summary,
        note: activityForm.note,
        happenedAt,
        followUpAt,
        relatedStatus: String(currentLead.status ?? ""),
        syncFollowUpToLead: activityForm.syncFollowUp,
        metadata: {
          stage: currentLead.statusDetail?.currentStage ?? null,
          reason: currentLead.statusDetail?.currentReason ?? null,
        },
      });
      if (activityForm.syncFollowUp) {
        await syncLeadWorkflowAutomation({
          lead: {
            ...currentLead,
            nextFollowUp: followUpAt ?? null,
            nextFollowUpDateKey: followUpAt ? followUpAt.toISOString().slice(0, 10) : null,
          },
          actor,
          status:
            isFollowUpStatus(currentLead.status) || isPaymentFollowUpStatus(currentLead.status)
              ? String(currentLead.status ?? "")
              : "followup",
          followUpDate: followUpAt,
          remarks: activityForm.note || activityForm.summary,
          stage: currentLead.statusDetail?.currentStage ?? null,
          reason: currentLead.statusDetail?.currentReason ?? null,
          source: "crm_activity_automation",
        });
      }
      setActivityForm((previous) => ({
        ...previous,
        summary: "",
        note: "",
        happenedAt: formatDateInput(new Date()),
        syncFollowUp: false,
      }));
      setActiveSection("activities");
    } catch (error) {
      console.error("Structured activity creation failed", error);
      alert("Failed to log activity.");
    } finally {
      setActivitySaving(false);
    }
  }

  async function handleCreateNote() {
    if (!currentLead.leadId || !noteBody.trim()) return;
    setNoteSaving(true);
    try {
      await createLeadCommandNote({ leadId: currentLead.leadId, actor, body: noteBody });
      setNoteBody("");
    } catch (error) {
      console.error("Note creation failed", error);
      alert("Failed to save note.");
    } finally {
      setNoteSaving(false);
    }
  }

  async function handleCreateDocument() {
    if (!currentLead.leadId || !documentForm.title.trim() || !documentForm.url.trim() || !documentForm.category.trim()) return;
    setDocumentSaving(true);
    try {
      await createLeadCommandDocument({ leadId: currentLead.leadId, actor, title: documentForm.title, url: documentForm.url, category: documentForm.category, note: documentForm.note });
      setDocumentForm({ title: "", url: "", category: "", note: "" });
    } catch (error) {
      console.error("Document reference creation failed", error);
      alert("Failed to add document reference.");
    } finally {
      setDocumentSaving(false);
    }
  }

  function handleApplyCommunicationPreset(presetId: string) {
    const preset = communicationPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setActivityForm((previous) => ({
      ...previous,
      type: preset.type,
      summary: preset.summary,
      note: preset.note,
      happenedAt: formatDateInput(new Date()),
      syncFollowUp: preset.syncFollowUp,
    }));
    setActiveSection("activities");
  }

  async function handleLogCommunication(input: {
    channel: "whatsapp" | "email";
    mode: "open" | "copy";
  }) {
    if (!currentLead?.leadId) return;
    const template = input.channel === "whatsapp" ? selectedWhatsappTemplate : selectedEmailTemplate;
    if (!template) return;
    const filled = input.channel === "whatsapp" ? filledWhatsappTemplate : filledEmailTemplate;
    if (!filled.body.trim()) return;

    setCommunicationSaving(true);
    try {
      const summary = `${input.channel === "whatsapp" ? "WhatsApp" : "Email"} ${input.mode === "open" ? "triggered" : "copied"}: ${template.label}`;
      await createLeadStructuredActivity({
        leadId: currentLead.leadId,
        actor,
        type: template.activityType,
        summary,
        note: communicationNote.trim() || null,
        happenedAt: new Date(),
        relatedStatus: String(currentLead.status ?? ""),
        metadata: {
          channel: input.channel,
          mode: input.mode,
          templateId: template.id,
          templateLabel: template.label,
          subject: filled.subject || null,
          bodyPreview: filled.body.slice(0, 240),
        },
      });

      if (input.mode === "copy") {
        const payload = input.channel === "email" && filled.subject
          ? `Subject: ${filled.subject}\n\n${filled.body}`
          : filled.body;
        await navigator.clipboard.writeText(payload);
      } else if (input.channel === "whatsapp" && currentLead.phone) {
        window.open(
          `${getWhatsappHref(currentLead.phone)}?text=${encodeURIComponent(filled.body)}`,
          "_blank",
          "noopener,noreferrer",
        );
      } else if (input.channel === "email" && currentLead.email) {
        window.location.href = getMailtoHref(currentLead.email, filled.subject, filled.body);
      }

      setCommunicationNote("");
    } catch (error) {
      console.error("Communication log failed", error);
      alert("Failed to log this outreach.");
    } finally {
      setCommunicationSaving(false);
    }
  }

  function handlePrimarySectionAction() {
    switch (activeSection) {
      case "status":
        if (canSaveStatusNow) void handleSaveStatus();
        return;
      case "activities":
        if (canSaveActivityNow) void handleCreateActivity();
        return;
      case "tasks":
        if (canSaveTaskNow) void handleCreateTask();
        return;
      case "notes":
        if (canSaveNoteNow) void handleCreateNote();
        return;
      case "documents":
        if (canSaveDocumentNow) void handleCreateDocument();
        return;
      case "assignment":
        if (canSaveAssignmentNow) void handleReassign();
        return;
      case "summary":
        if (canEditDetails) {
          if (canSaveDetailsNow) void handleSaveDetails();
          return;
        }
        jumpTo("status");
        return;
      default:
        return;
    }
  }

  const primaryAction = (() => {
    switch (activeSection) {
      case "status":
        return {
          label: statusSaving ? "Saving update..." : "Save update",
          disabled: !canSaveStatusNow,
        };
      case "activities":
        return {
          label: activitySaving ? "Logging activity..." : "Log activity",
          disabled: !canSaveActivityNow,
        };
      case "tasks":
        return {
          label: taskSaving ? "Creating task..." : "Create task",
          disabled: !canSaveTaskNow,
        };
      case "notes":
        return {
          label: noteSaving ? "Saving note..." : "Save note",
          disabled: !canSaveNoteNow,
        };
      case "documents":
        return {
          label: documentSaving ? "Adding document..." : "Add document",
          disabled: !canSaveDocumentNow,
        };
      case "assignment":
        return {
          label: assignmentSaving ? "Updating owner..." : "Reassign lead",
          disabled: !canSaveAssignmentNow,
        };
      case "summary":
        return canEditDetails
          ? {
              label: detailsSaving ? "Saving profile..." : "Save profile",
              disabled: !canSaveDetailsNow,
            }
          : {
              label: "Update stage",
              disabled: false,
            };
      default:
        return null;
    }
  })();

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-[100]">
      <DialogBackdrop transition className="fixed inset-0 bg-slate-950/45 backdrop-blur-sm transition-opacity duration-500 ease-in-out data-[closed]:opacity-0" />
      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-6 sm:pl-10">
            <DialogPanel transition className="pointer-events-auto w-screen max-w-[1024px] transform bg-[#F8FAFC] shadow-2xl transition duration-500 ease-in-out data-[closed]:translate-x-full sm:duration-700">
              <div className="flex h-full flex-col">
                <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-7">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-indigo-700">Lead Command Center</div>
                      <DialogTitle className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{toTitleCase(currentLead.name)}</DialogTitle>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        <span>{currentLead.phone ?? "No phone"}</span>
                        <span>{currentLead.email ?? "No email"}</span>
                        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{getLeadStatusLabel(currentLead.status)}</span>
                        {(currentLead.statusDetail?.currentReason || currentLead.subStatus) && (
                          <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">{currentLead.statusDetail?.currentReason ?? currentLead.subStatus}</span>
                        )}
                        {leadSlaMeta ? (
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${leadSlaMeta.toneClass}`}>{leadSlaMeta.label}</span>
                        ) : null}
                        {(currentLead.leadTags ?? []).slice(0, 4).map((tag, index) => (
                          <span key={`header-tag-${tag}-${index}`} className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                        <span>`Alt+1-{scopedSections.length}` sections</span>
                        <span>`Ctrl+Enter` save</span>
                        <span>`Alt+L` copy ID</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {supportsExecutionMode ? (
                        <button
                          type="button"
                          onClick={() => setSimpleExecutionMode((current) => !current)}
                          className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-100"
                        >
                          {simpleExecutionMode ? "Full drawer" : "Execution mode"}
                        </button>
                      ) : null}
                      <a href={getPhoneHref(currentLead.phone)} className={`inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium shadow-sm ${currentLead.phone ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "pointer-events-none border-slate-200 bg-slate-100 text-slate-400"}`}><PhoneIcon className="mr-2 h-4 w-4" />Call</a>
                      <a href={getWhatsappHref(currentLead.phone)} target="_blank" rel="noreferrer" className={`inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium shadow-sm ${currentLead.phone ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "pointer-events-none border-slate-200 bg-slate-100 text-slate-400"}`}><ChatBubbleLeftRightIcon className="mr-2 h-4 w-4" />WA</a>
                      <button type="button" onClick={() => { void navigator.clipboard.writeText(currentLead.leadId); }} className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"><ClipboardDocumentIcon className="mr-2 h-4 w-4" />Copy ID</button>
                      <button type="button" onClick={onClose} className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"><XMarkIcon className="mr-2 h-4 w-4" />Close</button>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {orderedScopedSections.map((section) => (
                      <button
                        key={section}
                        type="button"
                        onClick={() => jumpTo(section)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${
                          activeSection === section
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {getSectionLabel(section)}
                      </button>
                    ))}
                  </div>
                  {topExecutionSections.length > 0 ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Execution Quick Access
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {topExecutionSections.map((section) => {
                          const countText =
                            section === "activities"
                              ? `${leadActivities.length} logged`
                              : section === "tasks"
                                ? `${openLinkedTaskCount} open`
                                : `${getLeadStatusLabel(currentLead.status)}`;
                          const helperText =
                            section === "activities"
                              ? "Log call outcome fast"
                              : section === "tasks"
                                ? "Create next follow-up"
                                : "Update stage + reason";
                          return (
                            <button
                              key={`top-${section}`}
                              type="button"
                              onClick={() => jumpTo(section)}
                              className={`rounded-xl border px-3 py-2 text-left transition ${
                                activeSection === section
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                              }`}
                            >
                              <div className="text-xs font-semibold uppercase tracking-wide">
                                {getSectionLabel(section)}
                              </div>
                              <div className={`mt-1 text-sm font-semibold ${activeSection === section ? "text-white" : "text-slate-900"}`}>
                                {countText}
                              </div>
                              <div className={`mt-1 text-[11px] ${activeSection === section ? "text-slate-200" : "text-slate-500"}`}>
                                {helperText}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-24 pt-6 sm:px-7 sm:pb-28">
                  <div className="grid gap-6 min-[1700px]:grid-cols-[1.08fr_0.92fr]">
                    <div className="min-w-0 space-y-6">
                      {showSection("summary") ? (
                        <section id={sectionId("summary")} className={sectionCard(activeSection === "summary")}>
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">Lead Snapshot</div>
                            <div className="mt-1 text-sm text-slate-500">One surface for identity, next action, and supporting data.</div>
                          </div>
                          {isLeadLocked ? <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"><LockClosedIcon className="h-3.5 w-3.5" />Finalized lead</div> : null}
                        </div>
                        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Owner</div><div className="mt-1 text-sm font-semibold text-slate-900">{assignmentLabel}</div></div>
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Next Follow Up</div><div className="mt-1 text-sm font-semibold text-slate-900">{currentLead.nextFollowUp ? formatDateTime(currentLead.nextFollowUp) : "Not scheduled"}</div>{leadSlaMeta ? <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${leadSlaMeta.toneClass}`}>{leadSlaMeta.label}</div> : <div className="mt-2 text-[11px] text-slate-500">No active follow-up SLA.</div>}</div>
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Last Activity</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatDateTime(currentLead.lastActivityAt ?? currentLead.lastActionAt ?? currentLead.updatedAt)}</div><div className="mt-1 text-[11px] text-slate-500">{currentLead.lastActivityType ? getLeadActivityTypeLabel(currentLead.lastActivityType) : "No structured activity yet"}</div></div>
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lead ID</div><div className="mt-1 truncate font-mono text-sm font-semibold text-slate-900">{currentLead.leadId}</div></div>
                        </div>
                        <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><DocumentDuplicateIcon className="h-4 w-4" />Identity and Program</div>
                            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                              <div><div className="text-xs text-slate-500">Full Name</div><div className="mt-1 font-medium text-slate-900">{toTitleCase(currentLead.name)}</div></div>
                              <div><div className="text-xs text-slate-500">Phone</div><div className="mt-1 font-medium text-slate-900">{currentLead.phone ?? "-"}</div></div>
                              <div><div className="text-xs text-slate-500">Email</div><div className="mt-1 font-medium text-slate-900">{currentLead.email ?? "-"}</div></div>
                              <div><div className="text-xs text-slate-500">Education</div><div className="mt-1 font-medium text-slate-900">{currentLead.currentEducation ?? "-"}</div></div>
                              <div><div className="text-xs text-slate-500">University</div><div className="mt-1 font-medium text-slate-900">{currentLead.enrollmentDetails?.university || currentLead.targetUniversity || "-"}</div></div>
                              <div><div className="text-xs text-slate-500">Course / Degree</div><div className="mt-1 font-medium text-slate-900">{currentLead.enrollmentDetails?.course || currentLead.targetDegree || "-"}</div></div>
                              <div><div className="text-xs text-slate-500">Location</div><div className="mt-1 font-medium text-slate-900">{currentLead.leadLocation ?? "-"}</div></div>
                              <div><div className="text-xs text-slate-500">Preferred Language</div><div className="mt-1 font-medium text-slate-900">{currentLead.preferredLanguage ?? "-"}</div></div>
                              <div className="sm:col-span-2"><div className="text-xs text-slate-500">Lead Tags</div><div className="mt-1 flex flex-wrap gap-1.5">{(currentLead.leadTags ?? []).length > 0 ? (currentLead.leadTags ?? []).map((tag, index) => <span key={`identity-tag-${tag}-${index}`} className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{tag}</span>) : <span className="font-medium text-slate-900">-</span>}</div></div>
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">Next Best Actions</div>
                          <div className="mt-4 grid gap-2">
                            {leadSlaMeta ? (
                              <button type="button" onClick={() => jumpTo("status")} className="rounded-xl bg-white/10 px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/15">
                                <div>{leadSlaMeta.bucket === "overdue" ? "Recover missed follow-up SLA" : "Complete today's follow-up SLA"}</div>
                                <div className="mt-1 text-xs text-slate-300">{leadSlaMeta.label}. Update status and next step now.</div>
                              </button>
                            ) : null}
                            {nextBestActions.length > 0 ? nextBestActions.map((suggestion) => (
                              <button key={suggestion.id} type="button" onClick={() => jumpTo(suggestion.target)} className="rounded-xl bg-white/10 px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/15">
                                <div>{suggestion.title}</div>
                                  <div className="mt-1 text-xs text-slate-300">{suggestion.detail}</div>
                                </button>
                              )) : (
                                <>
                                  <button type="button" onClick={() => jumpTo("status")} className="rounded-xl bg-white/10 px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/15">Update the stage and reason</button>
                                  <button type="button" onClick={() => jumpTo("activities")} className="rounded-xl bg-white/10 px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/15">Log what just happened</button>
                                  <button type="button" onClick={() => jumpTo("tasks")} className="rounded-xl bg-white/10 px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/15">Create the next follow-up task</button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">Education and KYC</div>
                              <div className="mt-1 text-sm text-slate-500">Managers can update profile details without leaving the drawer.</div>
                            </div>
                            {!canEditDetails ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">View only</span> : null}
                          </div>
                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <div><label className="block text-xs font-medium text-slate-600">Education</label><input type="text" value={formData.education} onChange={(event) => setFormData((previous) => ({ ...previous, education: event.target.value }))} disabled={!canEditDetails} className={`mt-1 block w-full rounded-xl border px-3 py-2 text-sm ${canEditDetails ? "border-slate-300 bg-white text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" : "border-slate-200 bg-slate-50 text-slate-500"}`} /></div>
                            <div><label className="block text-xs font-medium text-slate-600">University</label><input type="text" value={formData.university} onChange={(event) => setFormData((previous) => ({ ...previous, university: event.target.value }))} disabled={!canEditDetails} className={`mt-1 block w-full rounded-xl border px-3 py-2 text-sm ${canEditDetails ? "border-slate-300 bg-white text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" : "border-slate-200 bg-slate-50 text-slate-500"}`} /></div>
                            <div><label className="block text-xs font-medium text-slate-600">Location</label><input type="text" value={formData.location} onChange={(event) => setFormData((previous) => ({ ...previous, location: event.target.value }))} disabled={!canEditDetails} placeholder="Example: Mumbai / West Zone" className={`mt-1 block w-full rounded-xl border px-3 py-2 text-sm ${canEditDetails ? "border-slate-300 bg-white text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" : "border-slate-200 bg-slate-50 text-slate-500"}`} /></div>
                            <div><label className="block text-xs font-medium text-slate-600">Preferred Language</label><input type="text" value={formData.language} onChange={(event) => setFormData((previous) => ({ ...previous, language: event.target.value }))} disabled={!canEditDetails} placeholder="Example: Hindi / English" className={`mt-1 block w-full rounded-xl border px-3 py-2 text-sm ${canEditDetails ? "border-slate-300 bg-white text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" : "border-slate-200 bg-slate-50 text-slate-500"}`} /></div>
                            <div><label className="block text-xs font-medium text-slate-600">Aadhar</label><input type="text" value={formData.aadhar} onChange={(event) => setFormData((previous) => ({ ...previous, aadhar: event.target.value }))} disabled={!canEditDetails} className={`mt-1 block w-full rounded-xl border px-3 py-2 text-sm ${canEditDetails ? "border-slate-300 bg-white text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" : "border-slate-200 bg-slate-50 text-slate-500"}`} /></div>
                            <div><label className="block text-xs font-medium text-slate-600">PAN</label><input type="text" value={formData.pan} onChange={(event) => setFormData((previous) => ({ ...previous, pan: event.target.value }))} disabled={!canEditDetails} className={`mt-1 block w-full rounded-xl border px-3 py-2 text-sm ${canEditDetails ? "border-slate-300 bg-white text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" : "border-slate-200 bg-slate-50 text-slate-500"}`} /></div>
                            <div className="md:col-span-2"><label className="block text-xs font-medium text-slate-600">Lead tags (comma separated)</label><input type="text" value={leadTagsInput} onChange={(event) => setLeadTagsInput(event.target.value)} disabled={!canEditDetails} placeholder="Example: High Intent, Scholarship, South Zone" className={`mt-1 block w-full rounded-xl border px-3 py-2 text-sm ${canEditDetails ? "border-slate-300 bg-white text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" : "border-slate-200 bg-slate-50 text-slate-500"}`} />{parsedLeadTags.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{parsedLeadTags.map((tag) => <span key={`editor-tag-${tag}`} className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{tag}</span>)}</div> : <div className="mt-2 text-[11px] text-slate-500">No tags added yet.</div>}</div>
                            <div className="md:col-span-2"><label className="block text-xs font-medium text-slate-600">Address</label><textarea value={formData.address} onChange={(event) => setFormData((previous) => ({ ...previous, address: event.target.value }))} disabled={!canEditDetails} rows={3} className={`mt-1 block w-full rounded-xl border px-3 py-2 text-sm ${canEditDetails ? "border-slate-300 bg-white text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" : "border-slate-200 bg-slate-50 text-slate-500"}`} /></div>
                          </div>
                          {canEditDetails ? <div className="mt-4 flex justify-end"><button type="button" onClick={handleSaveDetails} disabled={detailsSaving} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60">{detailsSaving ? "Saving details..." : "Save details"}</button></div> : null}
                        </div>
                        {enrollmentVisible ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700"><CheckBadgeIcon className="h-4 w-4" />Enrollment Details</div><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><div className="text-xs text-emerald-600/80">University</div><div className="mt-1 font-semibold text-emerald-950">{currentLead.enrollmentDetails?.university || "-"}</div></div><div><div className="text-xs text-emerald-600/80">Course</div><div className="mt-1 font-semibold text-emerald-950">{currentLead.enrollmentDetails?.course || "-"}</div></div><div><div className="text-xs text-emerald-600/80">Course Fees</div><div className="mt-1 font-semibold text-emerald-950">{currentLead.enrollmentDetails?.fee ? `Rs ${currentLead.enrollmentDetails.fee.toLocaleString("en-IN")}` : "-"}</div></div><div><div className="text-xs text-emerald-600/80">Sale Closed By</div><div className="mt-1 font-semibold text-emerald-950">{closerName}</div></div></div></div> : null}
                        </section>
                      ) : null}

                      {showSection("notes") ? (
                        <section id={sectionId("notes")} className={sectionCard(activeSection === "notes")}>
                        <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-slate-900">Internal Notes</div><div className="mt-1 text-sm text-slate-500">Keep internal context here. Customer interactions belong in Activities.</div></div><div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">{leadNotes.length} note{leadNotes.length === 1 ? "" : "s"}</div></div>
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"><label className="block text-xs font-medium text-slate-600">Add note</label><textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} rows={4} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" placeholder="Capture internal context, coaching, or manager instructions..." /><div className="mt-3 flex justify-end"><button type="button" onClick={handleCreateNote} disabled={noteSaving || !noteBody.trim()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60">{noteSaving ? "Saving note..." : "Save note"}</button></div></div>
                        <div className="mt-4 space-y-3">{leadNotes.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No internal notes yet.</div> : leadNotes.map((note) => <article key={note.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div className="text-sm font-semibold text-slate-900">{note.author.name ?? note.author.uid}</div><div className="text-xs text-slate-400">{formatDateTime(note.createdAt)}</div></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{note.body}</p></article>)}</div>
                        </section>
                      ) : null}

                      {showSection("documents") ? (
                        <section id={sectionId("documents")} className={sectionCard(activeSection === "documents")}>
                        <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-slate-900">Document References</div><div className="mt-1 text-sm text-slate-500">Keep links to forms, fee sheets, or proofs with the lead.</div></div><div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">{leadDocuments.length} item{leadDocuments.length === 1 ? "" : "s"}</div></div>
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"><div className="grid gap-4 md:grid-cols-2"><div><label className="block text-xs font-medium text-slate-600">Title</label><input type="text" value={documentForm.title} onChange={(event) => setDocumentForm((previous) => ({ ...previous, title: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" /></div><div><label className="block text-xs font-medium text-slate-600">Category</label><input type="text" value={documentForm.category} onChange={(event) => setDocumentForm((previous) => ({ ...previous, category: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" /></div><div className="md:col-span-2"><label className="block text-xs font-medium text-slate-600">URL</label><input type="url" value={documentForm.url} onChange={(event) => setDocumentForm((previous) => ({ ...previous, url: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" placeholder="https://..." /></div><div className="md:col-span-2"><label className="block text-xs font-medium text-slate-600">Context</label><textarea value={documentForm.note} onChange={(event) => setDocumentForm((previous) => ({ ...previous, note: event.target.value }))} rows={3} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" /></div></div><div className="mt-3 flex justify-end"><button type="button" onClick={handleCreateDocument} disabled={documentSaving || !documentForm.title.trim() || !documentForm.url.trim() || !documentForm.category.trim()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60">{documentSaving ? "Adding document..." : "Add document"}</button></div></div>
                        <div className="mt-4 space-y-3">{leadDocuments.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No document links yet.</div> : leadDocuments.map((item) => <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-slate-900">{item.title}</div><div className="mt-1 text-xs font-medium uppercase tracking-wide text-indigo-600">{item.category}</div></div><a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"><ArrowTopRightOnSquareIcon className="mr-2 h-4 w-4" />Open</a></div>{item.note ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.note}</p> : null}<div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400"><span>{item.uploadedBy.name ?? item.uploadedBy.uid}</span><span>|</span><span>{formatDateTime(item.createdAt)}</span></div></article>)}</div>
                        </section>
                      ) : null}
                    </div>
                    <div className="min-w-0 space-y-6">
                      {showSection("assignment") ? (
                        <section id={sectionId("assignment")} className={sectionCard(activeSection === "assignment")}>
                        <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-slate-900">Assignment and Ownership</div><div className="mt-1 text-sm text-slate-500">Keep the right BDA on the lead without leaving the drawer.</div></div><div className="flex flex-wrap items-center gap-2"><div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">Current owner: {assignmentLabel}</div><div className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">{currentCustodyState.replace("_", " ")}</div></div></div>
                        {canManageAssignment ? (
                          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                            <label className="block text-xs font-medium text-slate-600">Assign to</label>
                            <select value={selectedAssignee} onChange={(event) => setSelectedAssignee(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500">
                              <option value="">Select assignee...</option>
                              {assignableUsers.map((user) => <option key={user.uid} value={user.uid}>{user.displayName || user.email} ({user.orgRole || user.role})</option>)}
                            </select>
                            <label className="mt-3 block">
                              <span className="text-xs font-medium text-slate-600">Transfer reason</span>
                              <textarea
                                value={assignmentReason}
                                onChange={(event) => setAssignmentReason(event.target.value)}
                                rows={3}
                                className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                                placeholder="Why is this lead moving? Example: manager pullback before redistribution."
                              />
                            </label>
                            <div className="mt-3">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reason templates</div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {assignmentReasonTemplates.map((template) => (
                                  <button
                                    key={template.id}
                                    type="button"
                                    onClick={() => applyAssignmentTemplate(template.id)}
                                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    {template.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {!assignmentReason.trim() ? (
                              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                Transfer reason is mandatory for pullback and reassignment.
                              </div>
                            ) : null}
                            <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                              <input type="checkbox" checked={resetStatusOnReassign} onChange={(event) => setResetStatusOnReassign(event.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                              Reset status to New for the next owner
                            </label>
                            {openLinkedTaskCount > 0 ? (
                              <>
                                <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                                  <input type="checkbox" checked={reassignOpenTasks} onChange={(event) => setReassignOpenTasks(event.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                                  Move {openLinkedTaskCount} open linked task{openLinkedTaskCount === 1 ? "" : "s"} to the new owner
                                </label>
                                <div className={`mt-3 rounded-xl border px-3 py-3 text-xs ${reassignOpenTasks ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                                  {reassignOpenTasks
                                    ? "Open linked tasks will move with the lead, so the next owner starts from a clean queue."
                                    : "Open linked tasks will stay with the current assignee and show owner drift until they are manually closed or reassigned."}
                                </div>
                              </>
                            ) : null}
                            {ownerDriftTaskCount > 0 ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">{ownerDriftTaskCount} open linked task{ownerDriftTaskCount === 1 ? "" : "s"} already sit with a different owner.</div> : null}
                            <div className="mt-4 flex flex-wrap justify-end gap-2">
                              {currentUser.uid !== (currentLead.assignedTo ?? currentLead.ownerUid ?? "") ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleReassign(
                                      currentUser.uid,
                                      assignmentReason.trim() ||
                                        getAssignmentReasonTemplate(
                                          DEFAULT_PULLBACK_REASON_TEMPLATE_ID,
                                        ).text,
                                    )
                                  }
                                  disabled={assignmentSaving}
                                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                                >
                                  Pull back to me
                                </button>
                              ) : null}
                              <button type="button" onClick={() => void handleReassign()} disabled={!canSaveAssignmentNow} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-500 disabled:opacity-60">{assignmentSaving ? "Updating owner..." : "Transfer lead"}</button>
                            </div>
                            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transfer timeline</div>
                                  <div className="mt-1 text-sm font-semibold text-slate-900">
                                    {transferHistoryRows.length} transfer event{transferHistoryRows.length === 1 ? "" : "s"}
                                  </div>
                                </div>
                                <div className="text-right text-[11px] text-slate-500">
                                  <div>{filteredTransferHistoryRows.length} in current filter</div>
                                  <div>Queryable by state, owner, actor, reason</div>
                                </div>
                              </div>
                              <div className="mt-3 grid gap-2 md:grid-cols-3">
                                <select
                                  value={transferHistoryStateFilter}
                                  onChange={(event) =>
                                    setTransferHistoryStateFilter(
                                      event.target.value as LeadCustodyState | "all",
                                    )
                                  }
                                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                                >
                                  <option value="all">All states</option>
                                  <option value="owned">Owned</option>
                                  <option value="pulled_back">Pulled back</option>
                                  <option value="pooled">Pooled</option>
                                  <option value="reassigned">Reassigned</option>
                                  <option value="locked">Locked</option>
                                </select>
                                <select
                                  value={transferHistoryActorFilter}
                                  onChange={(event) => setTransferHistoryActorFilter(event.target.value)}
                                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                                >
                                  <option value="all">All actors</option>
                                  {transferHistoryActors.map((actorOption) => (
                                    <option key={actorOption.uid} value={actorOption.uid}>
                                      {actorOption.name}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="text"
                                  value={transferHistoryQuery}
                                  onChange={(event) => setTransferHistoryQuery(event.target.value)}
                                  placeholder="Search owner/reason/ID..."
                                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                                />
                              </div>
                              {filteredTransferHistoryRows.length === 0 ? (
                                <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-xs text-slate-500">
                                  No transfer entries matched this search.
                                </div>
                              ) : (
                                <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                                  {filteredTransferHistoryRows.map((entry) => (
                                    <article key={entry.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="font-semibold uppercase tracking-wide text-slate-700">
                                          {entry.custodyState.replace("_", " ")}
                                        </div>
                                        <div className="text-slate-400">{formatDateTime(entry.transferredAt)}</div>
                                      </div>
                                      <div className="mt-1 text-slate-700">
                                        {entry.previousOwnerName || entry.previousOwnerUid || "Pool"} to {entry.currentOwnerName || entry.currentOwnerUid || "Pool"}
                                      </div>
                                      <div className="mt-1 text-slate-500">Reason: {entry.reason}</div>
                                      <div className="mt-1 text-slate-400">By {entry.transferredBy?.name || entry.transferredBy?.uid || "-"}</div>
                                      <div className="mt-1 text-slate-400">Transfer ID: {entry.id}</div>
                                    </article>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">You can view the owner here, but reassignment is limited to authorized CRM roles.</div>}
                        </section>
                      ) : null}

                      {showSection("activities") ? (
                        <section id={sectionId("activities")} className={sectionCard(activeSection === "activities")}>
                        <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-slate-900">Activities</div><div className="mt-1 text-sm text-slate-500">Log what happened with the lead. Tasks are only for what happens next.</div></div><div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">{leadActivities.length} activity{leadActivities.length === 1 ? "" : "ies"}</div></div>
                        <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">Communication Center</div>
                              <div className="mt-1 text-sm text-slate-600">Use templates, structured outcomes, and one-click outreach from the same drawer.</div>
                            </div>
                            <div className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-700">
                              Faster timeline logging
                            </div>
                          </div>
                          <div className="mt-4 grid gap-4 min-[1700px]:grid-cols-[0.9fr_1.1fr]">
                            <div className="min-w-0 space-y-4">
                              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick outcomes</div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {communicationPresets.map((preset) => (
                                    <button
                                      key={preset.id}
                                      type="button"
                                      onClick={() => handleApplyCommunicationPreset(preset.id)}
                                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                    >
                                      {preset.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Outreach note</div>
                                <textarea
                                  value={communicationNote}
                                  onChange={(event) => setCommunicationNote(event.target.value)}
                                  rows={4}
                                  className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                                  placeholder="Capture the promise, objection, or exact message context for this outreach..."
                                />
                              </div>
                            </div>
                            <div className="grid min-w-0 gap-4 min-[1700px]:grid-cols-2">
                              <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">WhatsApp templates</div>
                                    <div className="mt-1 text-xs text-slate-500">Open a prefilled WhatsApp and log the outreach in the same step.</div>
                                  </div>
                                  <ChatBubbleLeftRightIcon className="h-5 w-5 text-slate-400" />
                                </div>
                                <select
                                  value={selectedWhatsappTemplateId}
                                  onChange={(event) => setSelectedWhatsappTemplateId(event.target.value)}
                                  className="mt-3 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                                >
                                  {whatsappTemplates.map((template) => (
                                    <option key={template.id} value={template.id}>
                                      {template.label}
                                    </option>
                                  ))}
                                </select>
                                <div className="mt-3 max-h-44 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 custom-scrollbar">
                                  <div className="whitespace-pre-wrap break-words">
                                    {filledWhatsappTemplate.body || "No WhatsApp template selected."}
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleLogCommunication({ channel: "whatsapp", mode: "open" })}
                                    disabled={communicationSaving || !currentLead.phone}
                                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
                                  >
                                    {communicationSaving ? "Logging..." : "Log + Open WA"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleLogCommunication({ channel: "whatsapp", mode: "copy" })}
                                    disabled={communicationSaving}
                                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                                  >
                                    Copy WA text
                                  </button>
                                </div>
                              </div>
                              <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">Email templates</div>
                                    <div className="mt-1 text-xs text-slate-500">Prepare subject and body, then open the mail client or copy the draft.</div>
                                  </div>
                                  <DocumentTextIcon className="h-5 w-5 text-slate-400" />
                                </div>
                                <select
                                  value={selectedEmailTemplateId}
                                  onChange={(event) => setSelectedEmailTemplateId(event.target.value)}
                                  className="mt-3 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                                >
                                  {emailTemplates.map((template) => (
                                    <option key={template.id} value={template.id}>
                                      {template.label}
                                    </option>
                                  ))}
                                </select>
                                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subject</div>
                                  <div className="mt-1 break-words">{filledEmailTemplate.subject || "No subject"}</div>
                                  <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Body</div>
                                  <div className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap break-words pr-1 custom-scrollbar">{filledEmailTemplate.body || "No email template selected."}</div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleLogCommunication({ channel: "email", mode: "open" })}
                                    disabled={communicationSaving || !currentLead.email}
                                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
                                  >
                                    {communicationSaving ? "Logging..." : "Log + Open Email"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleLogCommunication({ channel: "email", mode: "copy" })}
                                    disabled={communicationSaving}
                                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                                  >
                                    Copy email draft
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div><label className="block text-xs font-medium text-slate-600">Activity Type</label><select value={activityForm.type} onChange={(event) => setActivityForm((previous) => ({ ...previous, type: event.target.value as LeadStructuredActivityType }))} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500">{LEAD_ACTIVITY_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
                            <div><label className="block text-xs font-medium text-slate-600">Summary</label><input type="text" value={activityForm.summary} onChange={(event) => setActivityForm((previous) => ({ ...previous, summary: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" placeholder={getLeadActivityTypeLabel(activityForm.type)} /></div>
                            <div><label className="block text-xs font-medium text-slate-600">Happened At</label><input type="datetime-local" value={activityForm.happenedAt} onChange={(event) => setActivityForm((previous) => ({ ...previous, happenedAt: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" /></div>
                            <div><label className="block text-xs font-medium text-slate-600">Follow Up At</label><input type="datetime-local" value={activityForm.followUpAt} onChange={(event) => setActivityForm((previous) => ({ ...previous, followUpAt: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" /></div>
                            <div className="md:col-span-2"><label className="block text-xs font-medium text-slate-600">Notes</label><textarea value={activityForm.note} onChange={(event) => setActivityForm((previous) => ({ ...previous, note: event.target.value }))} rows={3} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" placeholder="Capture the objection, promise, blocker, or exact outcome..." /></div>
                          </div>
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <label className="inline-flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={activityForm.syncFollowUp} onChange={(event) => setActivityForm((previous) => ({ ...previous, syncFollowUp: event.target.checked }))} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />Sync follow-up date to the lead</label>
                            <button type="button" onClick={handleCreateActivity} disabled={activitySaving || !activityForm.happenedAt || (activityForm.syncFollowUp && !activityForm.followUpAt)} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60">{activitySaving ? "Logging activity..." : "Log activity"}</button>
                          </div>
                        </div>
                        <div className="mt-4 space-y-3">{leadActivities.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No activities yet. Start with the first call or outreach outcome.</div> : leadActivities.map((activity) => <article key={activity.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-slate-900">{activity.summary}</div><div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className={`rounded-full border px-2.5 py-1 font-medium ${activityTone(activity.type)}`}>{getLeadActivityTypeLabel(activity.type)}</span><span>Happened {formatDateTime(activity.happenedAt)}</span>{activity.followUpAt ? <span>Next follow up {formatDateTime(activity.followUpAt)}</span> : null}</div></div><div className="text-right text-xs text-slate-400"><div>{activity.actor.name ?? activity.actor.uid}</div><div>{activity.actor.role ?? "CRM"}</div></div></div>{activity.note ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{activity.note}</p> : null}</article>)}</div>
                        </section>
                      ) : null}

                      {showSection("tasks") ? (
                        <section id={sectionId("tasks")} className={sectionCard(activeSection === "tasks")}>
                        <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-slate-900">Pending Tasks</div><div className="mt-1 text-sm text-slate-500">Create next actions only. Completed conversations belong in Activities.</div></div><div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">{linkedTasks.length} linked task{linkedTasks.length === 1 ? "" : "s"}</div></div>
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"><div className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2"><label className="block text-xs font-medium text-slate-600">Task title</label><input type="text" value={taskForm.title} onChange={(event) => setTaskForm((previous) => ({ ...previous, title: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" /></div><div className="md:col-span-2"><label className="block text-xs font-medium text-slate-600">Task details</label><textarea value={taskForm.description} onChange={(event) => setTaskForm((previous) => ({ ...previous, description: event.target.value }))} rows={3} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" /></div><div><label className="block text-xs font-medium text-slate-600">Assign to</label><select value={taskForm.assigneeUid} onChange={(event) => setTaskForm((previous) => ({ ...previous, assigneeUid: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500">{taskAssignees.map((user) => <option key={user.uid} value={user.uid}>{user.displayName || user.email} ({user.orgRole || user.role})</option>)}</select></div><div><label className="block text-xs font-medium text-slate-600">Priority</label><select value={taskForm.priority} onChange={(event) => setTaskForm((previous) => ({ ...previous, priority: event.target.value as "high" | "medium" | "low" }))} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div><div className="md:col-span-2"><label className="block text-xs font-medium text-slate-600">Deadline</label><input type="datetime-local" value={taskForm.deadline} onChange={(event) => setTaskForm((previous) => ({ ...previous, deadline: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500" /></div></div><div className="mt-4 flex justify-end"><button type="button" onClick={handleCreateTask} disabled={taskSaving || !taskForm.title.trim() || !taskForm.assigneeUid} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60">{taskSaving ? "Creating task..." : "Create task"}</button></div></div>
                        <div className="mt-4 space-y-3">{linkedTasks.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No linked tasks yet. Create the next follow-up from here.</div> : linkedTasks.map((task) => { const assignee = userDirectory.get(task.assignedTo ?? task.assigneeUid ?? ""); const isOverdue = !!task.deadline && toDate(task.deadline).getTime() < Date.now() && task.status !== "completed"; const hasOwnerDrift = (task.assignedTo ?? task.assigneeUid ?? null) !== (currentLead.assignedTo ?? currentLead.ownerUid ?? null) && task.status !== "completed"; return <article key={task.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-slate-900">{task.title}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">{task.priority}</span><span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">{task.status}</span>{hasOwnerDrift ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-medium text-amber-700">Owner drift</span> : null}{task.deadline ? <span className={isOverdue ? "text-rose-600" : "text-slate-500"}>Due {formatDateTime(task.deadline)}</span> : null}</div></div><a href={`/tasks?taskId=${task.id}`} className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"><ArrowTopRightOnSquareIcon className="mr-2 h-4 w-4" />Open</a></div>{task.description ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{task.description}</p> : null}<div className="mt-3 text-xs text-slate-400">Assigned to {assignee?.displayName || assignee?.email || task.assignedTo || task.assigneeUid || "-"}</div></article>; })}</div>
                        </section>
                      ) : null}

                      {showSection("status") ? (
                        <section id={sectionId("status")} className={sectionCard(activeSection === "status")}>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">Stage and Outcome</div>
                              <div className="mt-1 text-sm text-slate-500">
                                Update the lead state without leaving the drawer. Saving here also logs a structured activity.
                              </div>
                            </div>
                            {!canEditStatus ? (
                              <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                                Status locked
                              </div>
                            ) : null}
                          </div>

                          {!canEditStatus ? (
                            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                              {enrollmentVisible
                                ? "Enrollment is finalized. Only super admin can override this status."
                                : "This lead is locked. Only super admin can change the status."}
                            </div>
                          ) : null}

                          {canEditStatus ? (
                            <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">SOP quick outcomes</div>
                                  <div className="mt-1 text-xs text-indigo-700/80">
                                    One tap loads stage, reason, remarks, and follow-up defaults. Review and save.
                                  </div>
                                </div>
                                <div className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-[11px] font-semibold text-indigo-700">
                                  Sales-first
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {statusSopOutcomes.map((outcome) => (
                                  <button
                                    key={outcome.id}
                                    type="button"
                                    onClick={() => applySopOutcome(outcome.id)}
                                    className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                                  >
                                    {outcome.shortLabel}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                            <div>
                              <label className="block text-xs font-medium text-slate-600">Status (auto-set)</label>
                              <select value={status} disabled className="mt-1 block w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500">
                                <option value="new">New</option>
                                <option value="interested">Hot</option>
                                <option value="followup">Follow Up</option>
                                <option value={PAYMENT_FOLLOW_UP_STATUS}>Payment Follow Up</option>
                                <option value="not_interested">Cold</option>
                                <option value="closed">Closed</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-slate-600">Category</label>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {[CATEGORY_NOT_CONNECTED, CATEGORY_CONNECTED].map((category) => (
                                  <button
                                    key={category}
                                    type="button"
                                    onClick={() => {
                                      if (!canEditStatus) return;
                                      setActiveCategory(category);
                                      setStage(category);
                                      setReason("");
                                      setStatusAssistMessage(null);
                                    }}
                                    disabled={!canEditStatus}
                                    className={`rounded-xl px-3 py-2 text-xs font-medium transition ${activeCategory === category ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"} disabled:opacity-50`}
                                  >
                                    {category}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {activeHierarchy ? (
                              <div className="space-y-3">
                                {activeHierarchy.type === "direct" ? (
                                  <div>
                                    <label className="block text-xs font-medium text-slate-600">Reason</label>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {activeHierarchy.options.map((option) => (
                                        <button
                                          key={option}
                                          type="button"
                                          onClick={() => handleOptionSelect(option, activeCategory)}
                                          disabled={!canEditStatus}
                                          className={`rounded-xl px-3 py-2 text-xs font-medium transition ${reason === option ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"} disabled:opacity-50`}
                                        >
                                          {option}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    <div>
                                      <label className="block text-xs font-medium text-slate-600">Direct outcomes</label>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {activeHierarchy.options
                                          .filter((option) => option.type === "leaf")
                                          .map((option) => (
                                            <button
                                              key={option.label}
                                              type="button"
                                              onClick={() => handleOptionSelect(option.label, activeCategory)}
                                              disabled={!canEditStatus}
                                              className={`rounded-xl px-3 py-2 text-xs font-medium transition ${reason === option.label ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"} disabled:opacity-50`}
                                            >
                                              {option.label}
                                            </button>
                                          ))}
                                      </div>
                                    </div>
                                    {activeHierarchy.options
                                      .filter((option) => option.type === "group")
                                      .map((group) => (
                                        <div key={group.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                          <div className="text-xs font-semibold text-slate-800">{group.label}</div>
                                          <div className="mt-2 flex flex-wrap gap-2">
                                            {group.options.map((option) => (
                                              <button
                                                key={option}
                                                type="button"
                                                onClick={() => handleOptionSelect(option, group.label)}
                                                disabled={!canEditStatus}
                                                className={`rounded-xl px-3 py-2 text-xs font-medium transition ${reason === option ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"} disabled:opacity-50`}
                                              >
                                                {option}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                  </div>
                                )}
                              </div>
                            ) : null}

                            {statusAssistMessage ? (
                              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                                {statusAssistMessage}
                              </div>
                            ) : null}

                            {!showClosureForm && (isFollowUpStatus(status) || isPaymentFollowUpStatus(status)) ? (
                              <div>
                                <label className="block text-xs font-medium text-slate-600">Next follow-up date</label>
                                <input
                                  type="datetime-local"
                                  value={statusFollowUpAt}
                                  onChange={(event) => {
                                    setStatusFollowUpAt(event.target.value);
                                    setStatusFollowUpTouched(true);
                                  }}
                                  disabled={!canEditStatus}
                                  className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-slate-100"
                                />
                              </div>
                            ) : null}

                            {showClosureForm ? (
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                <ClosureForm onSubmit={handleClosureSubmit} onCancel={() => setReason("")} isSubmitting={statusSaving} />
                              </div>
                            ) : (
                              <div>
                                <label className="block text-xs font-medium text-slate-600">Remarks</label>
                                <textarea
                                  value={remarks}
                                  onChange={(event) => {
                                    setRemarks(event.target.value);
                                    setStatusRemarksTouched(true);
                                  }}
                                  disabled={!canEditStatus}
                                  rows={4}
                                  className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-slate-100"
                                  placeholder="Add notes about the interaction or outcome..."
                                />
                              </div>
                            )}

                            {!showClosureForm ? (
                              <div className="flex justify-end">
                                <button type="button" onClick={handleSaveStatus} disabled={statusSaving || !canEditStatus || !stage || !reason} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60">
                                  {statusSaving ? "Saving update..." : "Save update"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </section>
                      ) : null}

                      {canOverrideStatusLock && enrollmentVisible ? <section className="rounded-[26px] border border-red-200 bg-red-50 p-5"><div className="flex items-center gap-2 text-sm font-semibold text-red-900"><BanknotesIcon className="h-4 w-4 text-red-600" />Refund Initiation</div><div className="mt-4 space-y-4 rounded-2xl border border-red-200 bg-white p-4"><div><label className="block text-xs font-medium text-red-700">Refund reason</label><select value={refundReason} onChange={(event) => setRefundReason(event.target.value)} className="mt-1 block w-full rounded-xl border border-red-300 px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:ring-red-500"><option value="admission_cancelled">Admission Cancelled</option><option value="sale_cancelled">Sale Cancelled</option><option value="other">Other</option></select></div><div><label className="block text-xs font-medium text-red-700">Refund amount</label><input type="number" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} className="mt-1 block w-full rounded-xl border border-red-300 px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:ring-red-500" /></div><button type="button" onClick={handleRefund} disabled={refundSaving || !refundAmount} className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-60">{refundSaving ? "Processing refund..." : "Initiate refund and cancel admission"}</button></div></section> : null}

                      {showSection("audit") ? (
                        <section id={sectionId("audit")} className={sectionCard(activeSection === "audit")}>
                        <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-slate-900">Audit and Timeline</div><div className="mt-1 text-sm text-slate-500">Every action stays visible from the same drawer.</div></div><div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">{timelineEntries.length} recent event{timelineEntries.length === 1 ? "" : "s"}</div></div>
                        <div className="mt-4 space-y-3">{timelineEntries.length > 0 ? timelineEntries.map((entry) => <article key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div className="text-sm font-semibold text-slate-900">{entry.summary}</div><div className="text-xs text-slate-400">{formatDateTime(entry.createdAt)}</div></div><div className="mt-2 text-xs font-medium uppercase tracking-wide text-indigo-600">{entry.actor.name} {entry.actor.role ? `| ${entry.actor.role}` : ""}</div>{entry.metadata && Object.keys(entry.metadata).length > 0 ? <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{Object.entries(entry.metadata).slice(0, 4).map(([key, value]) => `${key}: ${value ?? "-"}`).join(" | ")}</div> : null}</article>) : (currentLead.history ?? []).length > 0 ? (currentLead.history ?? []).slice().reverse().slice(0, 6).map((entry, index) => <article key={`${entry.updatedBy}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div className="text-sm font-semibold text-slate-900">{entry.action}</div><div className="text-xs text-slate-400">{formatDateTime(entry.timestamp)}</div></div><div className="mt-2 text-xs text-slate-500">{entry.updatedByName} | {entry.oldStatus} to {entry.newStatus}</div>{entry.remarks ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{entry.remarks}</p> : null}</article>) : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No audit history available yet.</div>}</div>
                        </section>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="sticky bottom-0 z-10 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur sm:px-7">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
                      {quickActionSections.map((section) => (
                        <button
                          key={section}
                          type="button"
                          onClick={() => jumpTo(section)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${
                            activeSection === section
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {getSectionLabel(section)}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                      >
                        Close
                      </button>
                      {primaryAction ? (
                        <button
                          type="button"
                          onClick={handlePrimarySectionAction}
                          disabled={primaryAction.disabled}
                          className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
                        >
                          {primaryAction.label}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </DialogPanel>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
