import { isLeadTransferLocked } from "@/lib/crm/custody";
import { isPaymentFollowUpStatus, normalizeLeadStatus } from "@/lib/leads/status";
import { LeadDoc } from "@/lib/types/crm";

/**
 * Determines if a lead should be counted as a "Revenue" or "Enrolled" lead.
 * This logic is used across Mission Control (Super Admin) and Dashboard (Manager).
 * 
 * Criteria:
 * 1. Status is "Converted"
 * 2. Status is "PaymentFollowUp" or "Closed" AND has specific sub-status/reason
 * 3. SAFETY NET: Has valid enrollment details (fee > 0), regardless of status.
 */
export function isRevenueLead(lead: LeadDoc): boolean {
  const status = normalizeLeadStatus(lead.status);
  const subStatus = (lead.subStatus || "").toLowerCase().trim();
  const reason = (lead.statusDetail?.currentReason || "").toLowerCase().trim();

  // Safety Net: If fee is recorded, it's a sale.
  const hasValidEnrollmentDetails = !!lead.enrollmentDetails && Number(lead.enrollmentDetails.fee) > 0;

  if (hasValidEnrollmentDetails) return true;

  if (status === "converted") return true;

  if (isPaymentFollowUpStatus(status) || status === "closed") {
    return (
      subStatus === "enrollment generated" || 
      subStatus === "utr details" || 
      subStatus === "utr (loan details)" ||
      reason === "enrollment generated" ||
      reason === "utr details (loan details)" ||
      reason === "utr (loan details)"
    );
  }

  return false;
}

/**
 * Determines if a lead is eligible for distribution/assignment.
 * Revenue leads (Enrolled, Converted, etc.) should NEVER be reassigned via the funnel.
 */
export function isLeadDistributable(lead: LeadDoc): boolean {
  return !isRevenueLead(lead) && !isLeadTransferLocked(lead);
}
