import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { getTodayKey } from "@/lib/firebase/attendance";
import { getUserDoc } from "@/lib/firebase/users";
import {
  createAutoAssignmentNotifications,
  getBulkCrmRoutingAssignments,
  syncLeadWorkflowAutomation,
} from "@/lib/crm/automation-client";
import { buildLeadCustodyDefaults } from "@/lib/crm/custody";
import { syncLeadLinkedTasks } from "@/lib/tasks/lead-links";
import { LeadStatusValue } from "@/constants/leadStatus";
import { findLeadDuplicateCandidates, normalizeLeadEmail, normalizeLeadName, normalizeLeadPhone } from "@/lib/crm/dedupe";
import { applyLeadMutation, buildLeadActor, buildLeadHistoryEntry } from "@/lib/crm/timeline";
import type { LeadDoc } from "@/lib/types/crm";
import {
  PAYMENT_FOLLOW_UP_STATUS,
  getLeadStatusLabel,
  isFollowUpStatus,
  isPaymentFollowUpStatus,
  normalizeLeadStatus,
  toStoredLeadStatus,
} from "@/lib/leads/status";
import { generateLeadId, toTitleCase } from "@/lib/utils/stringUtils";

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildLeadIdentityFields(input: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}) {
  return {
    normalizedName: normalizeLeadName(input.name),
    normalizedPhone: normalizeLeadPhone(input.phone),
    normalizedEmail: normalizeLeadEmail(input.email),
  };
}

export async function createUniqueLeadId(): Promise<string> {
  if (!db) throw new Error("Firebase is not configured");
  let id = generateLeadId();
  let unique = false;
  let attempts = 0;

  while (!unique && attempts < 5) {
    const docRef = doc(db, "leads", id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      unique = true;
    } else {
      id = generateLeadId();
      attempts++;
    }
  }

  if (!unique) throw new Error("Failed to generate unique Lead ID after 5 attempts");
  return id;
}

export async function updateLeadClosure(
  leadId: string,
  enrollmentDetails: {
    university: string;
    course: string;
    fee: number;
    emiDetails: string;
    utrNumber?: string;
  },
  closedByUid: string,
) {
  if (!db) throw new Error("Firebase is not configured");

  const closer = await getUserDoc(closedByUid);
  if (!closer) throw new Error("Closing user not found");

  const leadRef = doc(db, "leads", leadId);
  const leadSnap = await getDoc(leadRef);
  if (!leadSnap.exists()) throw new Error("Lead not found");

  const lead = { ...(leadSnap.data() as LeadDoc), leadId };
  const actor = buildLeadActor({
    uid: closer.uid,
    displayName: closer.displayName,
    email: closer.email,
    role: closer.role,
    orgRole: closer.orgRole,
    employeeId: closer.employeeId ?? null,
  });

  await applyLeadMutation({
    leadId,
    actor,
    updates: {
      status: PAYMENT_FOLLOW_UP_STATUS,
      subStatus: "Enrollment Generated",
      enrollmentDetails: {
        ...enrollmentDetails,
        closedAt: serverTimestamp(),
      },
      closedBy: {
        uid: actor.uid,
        name: actor.name,
        employeeId: actor.employeeId ?? actor.uid,
      },
      custodyState: "locked",
      custodyReason: "Enrollment finalized",
      custodyUpdatedAt: serverTimestamp(),
      lastContactDateKey: getTodayKey(),
    },
    historyEntry: buildLeadHistoryEntry({
      action: "Lead Closed",
      actor,
      oldStatus: String(lead.status ?? "unknown"),
      newStatus: PAYMENT_FOLLOW_UP_STATUS,
      remarks: `Enrollment generated for ${enrollmentDetails.university} / ${enrollmentDetails.course}`,
    }),
    activityEntry: {
      type: "closed",
      at: new Date(),
      note: `Lead closed for ${enrollmentDetails.university} / ${enrollmentDetails.course}`,
    },
    timeline: {
      type: "closed",
      summary: `Enrollment generated for ${enrollmentDetails.university} / ${enrollmentDetails.course}`,
      metadata: {
        previousStatus: lead.status,
        university: enrollmentDetails.university,
        course: enrollmentDetails.course,
        fee: enrollmentDetails.fee,
        utrNumber: enrollmentDetails.utrNumber ?? null,
      },
    },
  });

  await syncLeadLinkedTasks({
    lead: {
      ...lead,
      status: PAYMENT_FOLLOW_UP_STATUS,
    },
    actorUid: actor.uid,
  });

  await syncLeadWorkflowAutomation({
    lead: {
      ...lead,
      status: PAYMENT_FOLLOW_UP_STATUS,
      subStatus: "Enrollment Generated",
      enrollmentDetails: {
        ...enrollmentDetails,
        closedAt: new Date(),
      },
    } as LeadDoc,
    actor,
    status: PAYMENT_FOLLOW_UP_STATUS,
    followUpDate: null,
    remarks: `Enrollment generated for ${enrollmentDetails.university} / ${enrollmentDetails.course}`,
    stage: "Payment Follow Up",
    reason: "Enrollment Generated",
    source: "crm_status_automation",
  });
}

export async function updateLeadStatusInDb(
  leadId: string,
  newStatus: LeadStatusValue,
  remarks: string,
  updatedByUid: string,
  followUpDate: Date | null,
) {
  if (!db) throw new Error("Firebase is not configured");

  const leadRef = doc(db, "leads", leadId);
  const [leadSnap, updater] = await Promise.all([getDoc(leadRef), getUserDoc(updatedByUid)]);

  if (!leadSnap.exists()) throw new Error("Lead not found");
  if (!updater) throw new Error("Updating user not found");

  const lead = { ...(leadSnap.data() as LeadDoc), leadId };
  const storedStatus = toStoredLeadStatus(newStatus);
  const actor = buildLeadActor({
    uid: updater.uid,
    displayName: updater.displayName,
    email: updater.email,
    role: updater.role,
    orgRole: updater.orgRole,
    employeeId: updater.employeeId ?? null,
  });

  const updates: Record<string, unknown> = {
    status: storedStatus,
    remarks: remarks || lead.remarks || "",
    lastContactDateKey: getTodayKey(),
  };

  if ((isFollowUpStatus(storedStatus) || isPaymentFollowUpStatus(storedStatus)) && followUpDate) {
    updates.nextFollowUp = Timestamp.fromDate(followUpDate);
    updates.nextFollowUpDateKey = toDateKey(followUpDate);
  } else if (!isFollowUpStatus(storedStatus) && !isPaymentFollowUpStatus(storedStatus)) {
    updates.nextFollowUp = null;
    updates.nextFollowUpDateKey = null;
  }

  if (normalizeLeadStatus(storedStatus) === "closed") {
    updates.custodyState = "locked";
    updates.custodyReason = remarks || "Lead moved to final closure";
    updates.custodyUpdatedAt = serverTimestamp();
  }

  await applyLeadMutation({
    leadId,
    actor,
    updates,
    historyEntry: buildLeadHistoryEntry({
      action: "Status Update",
      actor,
      oldStatus: String(lead.status ?? "unknown"),
      newStatus: storedStatus,
      remarks,
    }),
    activityEntry: {
      type: "updated",
      at: new Date(),
      note: remarks || `Status changed to ${getLeadStatusLabel(storedStatus)}`,
    },
    timeline: {
      type: "status_updated",
      summary: `Status changed to ${getLeadStatusLabel(storedStatus)}`,
      metadata: {
        previousStatus: lead.status,
        nextStatus: storedStatus,
        remarks: remarks || null,
        followUpDate: followUpDate ? toDateKey(followUpDate) : null,
      },
    },
  });

  await syncLeadLinkedTasks({
    lead: {
      ...lead,
      status: storedStatus,
      assignedTo: lead.assignedTo ?? lead.ownerUid ?? null,
      ownerUid: lead.ownerUid ?? lead.assignedTo ?? null,
    },
    actorUid: actor.uid,
  });

  await syncLeadWorkflowAutomation({
    lead: {
      ...lead,
      status: storedStatus,
      nextFollowUp:
        followUpDate && (isFollowUpStatus(storedStatus) || isPaymentFollowUpStatus(storedStatus))
          ? Timestamp.fromDate(followUpDate)
          : (!isFollowUpStatus(storedStatus) && !isPaymentFollowUpStatus(storedStatus))
            ? null
            : lead.nextFollowUp ?? null,
      nextFollowUpDateKey:
        followUpDate && (isFollowUpStatus(storedStatus) || isPaymentFollowUpStatus(storedStatus))
          ? toDateKey(followUpDate)
          : (!isFollowUpStatus(storedStatus) && !isPaymentFollowUpStatus(storedStatus))
            ? null
            : lead.nextFollowUpDateKey ?? null,
    } as LeadDoc,
    actor,
    status: storedStatus,
    followUpDate,
    remarks,
    source: "crm_status_automation",
  });
}

export async function getLeadsByAssignee(uid: string, limitCount = 200) {
  if (!db) throw new Error("Firebase is not configured");
  const q = query(collection(db, "leads"), where("ownerUid", "==", uid), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map((leadDoc) => ({ ...leadDoc.data(), leadId: leadDoc.id } as LeadDoc));
}

export async function createLeadAutoAssign(input: {
  managerId: string;
  fallbackAssigneeUid?: string | null;
  payload: {
    name: string;
    phone?: string | null;
    email?: string | null;
    currentEducation?: string | null;
    targetDegree?: string | null;
    targetUniversity?: string | null;
    leadLocation?: string | null;
    preferredLanguage?: string | null;
    source?: string | null;
    campaignName?: string | null;
    leadTags?: string[] | null;
    courseFees?: number | null;
    note?: string | null;
  };
}) {
  if (!db) throw new Error("Firebase is not configured");
  const todayKey = getTodayKey();
  const manager = await getUserDoc(input.managerId);
  const duplicateCandidates = await findLeadDuplicateCandidates({
    name: input.payload.name,
    phone: input.payload.phone ?? null,
    email: input.payload.email ?? null,
    targetUniversity: input.payload.targetUniversity ?? null,
    targetDegree: input.payload.targetDegree ?? null,
  });
  const duplicateReasons = Array.from(
    new Set(
      duplicateCandidates
        .flatMap((candidate) => candidate.reasons)
        .filter(Boolean),
    ),
  );
  const duplicateCandidateLeadIds = duplicateCandidates.map((candidate) => candidate.lead.leadId);
  const duplicateScore = duplicateCandidates[0]?.score ?? null;
  const leadId = await createUniqueLeadId();
  const assignmentPlan = await getBulkCrmRoutingAssignments(input.managerId, [leadId]);
  const assigneeUid = assignmentPlan.get(leadId) ?? input.fallbackAssigneeUid ?? null;
  const leadRef = doc(db, "leads", leadId);
  const timelineRef = doc(collection(db, "leads", leadId, "timeline"));
  const actor = buildLeadActor({
    uid: manager?.uid ?? input.managerId,
    displayName: manager?.displayName,
    email: manager?.email,
    role: manager?.role,
    orgRole: manager?.orgRole,
    employeeId: manager?.employeeId ?? null,
  });

  const name = toTitleCase(input.payload.name);
  const phone = input.payload.phone ?? null;
  const email = input.payload.email ?? null;
  const leadLocation = toTitleCase(input.payload.leadLocation ?? "");
  const preferredLanguage = toTitleCase(input.payload.preferredLanguage ?? "");
  const source = (input.payload.source ?? "Manual Entry").trim() || "Manual Entry";
  const campaignName = (input.payload.campaignName ?? "").trim();
  const normalizedLeadTags = Array.from(
    new Set(
      (input.payload.leadTags ?? [])
        .map((tag) => toTitleCase(tag))
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
  const contextualTags = Array.from(
    new Set(
      [
        leadLocation ? `Location: ${leadLocation}` : null,
        preferredLanguage ? `Language: ${preferredLanguage}` : null,
      ].filter(Boolean) as string[],
    ),
  );
  const mergedLeadTags = Array.from(new Set([...normalizedLeadTags, ...contextualTags]));
  const mergedLeadTagsNormalized = mergedLeadTags.map((tag) => tag.toLowerCase());
  const batch = writeBatch(db);

  batch.set(leadRef, {
    leadId,
    name,
    phone,
    email,
    ...buildLeadIdentityFields({ name, phone, email }),
    currentEducation: input.payload.currentEducation ?? null,
    targetDegree: input.payload.targetDegree ?? null,
    targetUniversity: input.payload.targetUniversity ?? null,
    leadLocation: leadLocation || null,
    preferredLanguage: preferredLanguage || null,
    courseFees: typeof input.payload.courseFees === "number" ? input.payload.courseFees : null,
    source,
    sourceNormalized: source.toLowerCase(),
    campaignName: campaignName || null,
    leadTags: mergedLeadTags.length > 0 ? mergedLeadTags : null,
    leadTagsNormalized: mergedLeadTagsNormalized.length > 0 ? mergedLeadTagsNormalized : null,
    status: "new",
    assignedTo: assigneeUid ?? null,
    ownerUid: assigneeUid ?? null,
    assignedBy: actor.uid,
    assignedAt: assigneeUid ? serverTimestamp() : null,
    ...buildLeadCustodyDefaults({
      ownerUid: assigneeUid,
      actor,
      reason: assigneeUid ? "Auto-assigned at lead creation" : "Lead created in shared pool",
      state: assigneeUid ? "owned" : "pooled",
    }),
    duplicateFlag: duplicateReasons.length > 0,
    duplicateReasons: duplicateReasons.length > 0 ? duplicateReasons : null,
    duplicateCandidateLeadIds: duplicateCandidateLeadIds.length > 0 ? duplicateCandidateLeadIds : null,
    duplicateScore,
    duplicateDetectedAt: duplicateReasons.length > 0 ? serverTimestamp() : null,
    duplicateDetectionSource: duplicateReasons.length > 0 ? "create" : null,
    activityHistory: [{ type: "created", at: new Date(), note: input.payload.note ?? null }],
    history: [
      buildLeadHistoryEntry({
        action: "Lead Created",
        actor,
        newStatus: "new",
        remarks: input.payload.note ?? "Lead created and auto-assigned",
      }),
    ],
    createdDateKey: todayKey,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastActionBy: actor.uid,
    lastActionAt: serverTimestamp(),
    kycData: {
      aadhar: null,
      pan: null,
      address: null,
      parentDetails: null,
    },
  } satisfies Partial<LeadDoc>);

  batch.set(timelineRef, {
    type: "created",
    summary: assigneeUid
      ? `Lead created and assigned to ${assigneeUid}`
      : "Lead created without an assignee",
    actor,
    metadata: {
      assignedTo: assigneeUid,
      source: "auto_assign",
      leadSource: source,
      campaignName: campaignName || null,
      leadLocation: leadLocation || null,
      preferredLanguage: preferredLanguage || null,
      routingMode: assigneeUid ? "availability_quota" : "unassigned_fallback",
      duplicateFlag: duplicateReasons.length > 0,
      duplicateReasons: duplicateReasons.length > 0 ? duplicateReasons.join(" | ") : null,
      duplicateCandidateLeadIds: duplicateCandidateLeadIds.length > 0 ? duplicateCandidateLeadIds : null,
    },
    createdAt: serverTimestamp(),
  });

  await batch.commit();
  await createAutoAssignmentNotifications({
    assignments: assignmentPlan,
    actor,
    sourceLabel: "auto-routed",
  });

  const snap = await getDoc(leadRef);
  return { ...(snap.data() as LeadDoc), leadId };
}

export async function checkLeadDuplicate(phone: string): Promise<boolean> {
  const candidates = await findLeadDuplicateCandidates({ phone });
  return candidates.length > 0;
}

export async function createDirectSaleLead(
  input: {
    name: string;
    phone: string;
    email?: string;
    state?: string;
    university: string;
    course: string;
    fee: number;
    registrationFee?: number;
    paymentMode: string;
    utrNumber: string;
  },
  currentUser: {
    uid: string;
    displayName: string | null;
    role?: string | null;
    orgRole?: string | null;
    employeeId?: string | null;
    email?: string | null;
  },
) {
  if (!db) throw new Error("Firebase is not configured");

  const duplicates = await findLeadDuplicateCandidates({
    name: input.name,
    phone: input.phone,
    email: input.email,
    targetUniversity: input.university,
    targetDegree: input.course,
  });

  if (duplicates.length > 0) {
    const summary = duplicates
      .slice(0, 3)
      .map((candidate) => `${candidate.lead.name} (${candidate.reasons.join(", ")})`)
      .join("; ");

    throw new Error(`Potential duplicate lead found: ${summary}`);
  }

  const todayKey = getTodayKey();
  const leadId = await createUniqueLeadId();
  const leadRef = doc(db, "leads", leadId);
  const timelineRef = doc(collection(db, "leads", leadId, "timeline"));
  const actor = buildLeadActor({
    uid: currentUser.uid,
    displayName: currentUser.displayName,
    email: currentUser.email,
    role: currentUser.role,
    orgRole: currentUser.orgRole,
    employeeId: currentUser.employeeId ?? null,
  });
  const name = toTitleCase(input.name);
  const phone = input.phone;
  const email = input.email || null;
  const registrationFee = Math.max(0, Number(input.registrationFee ?? 0));
  const payableAmount = Math.max(0, Number(input.fee || 0)) + registrationFee;
  const batch = writeBatch(db);

  batch.set(leadRef, {
    leadId,
    name,
    phone,
    email,
    ...buildLeadIdentityFields({ name, phone, email }),
    status: PAYMENT_FOLLOW_UP_STATUS,
    subStatus: "Enrollment Generated",
    isSelfGenerated: true,
    source: "Direct Entry",
    incentiveOwnerId: currentUser.uid,
    assignedTo: currentUser.uid,
    ownerUid: currentUser.uid,
    ...buildLeadCustodyDefaults({
      ownerUid: currentUser.uid,
      actor,
      reason: "Direct sale created by owner",
      state: "locked",
    }),
    closedBy: {
      uid: currentUser.uid,
      name: currentUser.displayName,
      employeeId: currentUser.employeeId,
    },
    createdBy: {
      uid: currentUser.uid,
      name: currentUser.displayName,
      role: currentUser.role,
      employeeId: currentUser.employeeId,
    },
    enrollmentDetails: {
      university: input.university,
      course: input.course,
      fee: input.fee,
      registrationFee,
      payableAmount,
      emiDetails: input.utrNumber,
      paymentMode: input.paymentMode,
      utrNumber: input.utrNumber,
      closedAt: serverTimestamp(),
    },
    createdDateKey: todayKey,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastActionAt: serverTimestamp(),
    lastActionBy: currentUser.uid,
    lastContactDateKey: todayKey,
    activityHistory: [
      { type: "created", at: new Date(), note: "Direct Sale Entry" },
      {
        type: "closed",
        at: new Date(),
        note: `Direct Sale Closed. University: ${input.university}, Course: ${input.course}`,
      },
    ],
    history: [
      buildLeadHistoryEntry({
        action: "Lead Created",
        actor,
        newStatus: PAYMENT_FOLLOW_UP_STATUS,
        remarks: "Direct sale entry created",
      }),
      buildLeadHistoryEntry({
        action: "Lead Closed",
        actor,
        oldStatus: "new",
        newStatus: PAYMENT_FOLLOW_UP_STATUS,
        remarks: `Direct sale closed for ${input.university} / ${input.course}`,
      }),
    ],
    kycData: {
      aadhar: null,
      pan: null,
      address: input.state || null,
      parentDetails: null,
    },
  } satisfies Partial<LeadDoc>);

  batch.set(timelineRef, {
    type: "created",
    summary: `Direct sale created for ${input.university} / ${input.course}`,
    actor,
    metadata: {
      source: "direct_sale",
      fee: input.fee,
      registrationFee,
      payableAmount,
      paymentMode: input.paymentMode,
      university: input.university,
      course: input.course,
      utrNumber: input.utrNumber,
    },
    createdAt: serverTimestamp(),
  });

  await batch.commit();

  await syncLeadWorkflowAutomation({
    lead: {
      ...(await getDoc(leadRef)).data(),
      leadId,
    } as LeadDoc,
    actor,
    status: PAYMENT_FOLLOW_UP_STATUS,
    followUpDate: null,
    remarks: "Direct sale entry created",
    stage: "Payment Follow Up",
    reason: "Direct Sale Entry",
    source: "crm_status_automation",
  });

  return leadRef.id;
}
