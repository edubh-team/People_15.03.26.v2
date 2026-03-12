import { db } from "@/lib/firebase/client";
import { collection, query, where, getDocs, Timestamp, QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import { getAttendanceDaysForMonth } from "@/lib/firebase/attendance";
import { getLeadStatusVariants, isPaymentFollowUpStatus, normalizeLeadStatus } from "@/lib/leads/status";
import type { LeadDoc } from "@/lib/types/crm";
import { startOfMonth, endOfMonth, format } from "date-fns";

export type ReportData = {
  employeeId: string;
  employeeName: string; // Fetch from user doc or pass as prop
  reportMonth: string; // "January 2026"
  generatedDate: string;
  
  attendance: {
    presentDays: number;
    absentDays: number;
    lateLogins: number;
    totalWorkingDays: number;
    attendancePercentage: number;
  };
  
  sales: {
    totalRevenue: number;
    totalSalesCount: number;
    deals: Array<{
      clientName: string;
      university: string;
      course: string;
      fee: number;
      date: string;
    }>;
  };
  
  funnel: {
    assigned: number;
    contacted: number;
    missed: number;
  };
  
  calls: {
    totalCalls: number;
  };
};

// Helper to safely parse date
function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (val instanceof Timestamp) return val.toDate();
  if (typeof val === 'string') return new Date(val);
  if (typeof val === 'object' && 'seconds' in val) {
    return new Date((val as { seconds: number }).seconds * 1000);
  }
  return null;
}

export async function fetchReportData(employeeId: string, targetMonth: Date): Promise<ReportData> {
  if (!db) throw new Error("Firebase not initialized");

  const start = startOfMonth(targetMonth);
  const end = endOfMonth(targetMonth);
  const year = targetMonth.getFullYear();
  const monthIndex = targetMonth.getMonth(); // 0-based
  
  const startKey = format(start, "yyyy-MM-dd");
  const endKey = format(end, "yyyy-MM-dd");

  // 1. Fetch User Details (for name and ID)
  let employeeName = "Unknown Employee";
  let displayEmployeeId = employeeId; // Default to UID if actual employeeId is missing

  try {
    const userSnap = await getDocs(query(collection(db, "users"), where("uid", "==", employeeId)));
    if (!userSnap.empty) {
      const userData = userSnap.docs[0].data();
      employeeName = userData.displayName || userData.email || "Employee";
      if (userData.employeeId) {
        displayEmployeeId = userData.employeeId;
      }
    }
  } catch (e) {
    console.error("Error fetching user", e);
  }

  // 2. Fetch Attendance
  let presentDays = 0;
  let lateLogins = 0;
  let totalWorkingDays = 0;
  
  try {
    const days = await getAttendanceDaysForMonth(employeeId, year, monthIndex);
    // Filter days that are actually in the month (getAttendanceDaysForMonth returns up to 62 days sometimes? No, it queries by path yyyy/months/mm so it should be exact)
    // But let's be safe.
    
    // Calculate stats
    // Assuming standard working days (exclude Sundays? or just count days with status)
    // "Total Present Days" = present/late day status or active attendance status.
    // "Late Logins" = checkInTime > 11:10 AM
    
    days.forEach(day => {
        const status = (day.status ?? "").toLowerCase();
        const dayStatus = (day.dayStatus ?? "").toLowerCase();
        const isPresentDay =
          dayStatus === "present" ||
          dayStatus === "late" ||
          status === "checked_in" ||
          status === "checked_out" ||
          status === "on_break" ||
          status === "present";

        if (isPresentDay) {
            presentDays++;
            // Check late
            if (day.checkedInAt) {
                const checkIn = toDate(day.checkedInAt);
                if (checkIn) {
                    const threshold = new Date(checkIn);
                    threshold.setHours(11, 10, 0, 0);
                    if (checkIn > threshold) {
                        lateLogins++;
                    }
                }
            }
        }
    });
    
    // Approximate working days as days in month excluding Sundays, or just use 26?
    // Let's count days passed so far in month or total days in month
    // For now, let's just say total days in month excluding weekends if we want %, 
    // or just use 30/31. Let's use 26 as standard or just count business days.
    // Simpler: Total days in month - Sundays.
    const d = new Date(start);
    while (d <= end) {
        if (d.getDay() !== 0) totalWorkingDays++;
        d.setDate(d.getDate() + 1);
    }

  } catch (e) {
    console.error("Error fetching attendance", e);
  }

  // 3. Fetch Leads & Sales
  // Strategy:
  // - Assigned: Leads created in date range.
  // - Contacted/Missed/Calls: Leads updated/contacted in date range.
  // - Sales: Leads with status 'closed' and closedAt in date range.
  
  const leadsRef = collection(db, "leads");
  
  // Parallel Queries
  const [createdSnap, contactedSnap, closedSnap] = await Promise.all([
    getDocs(query(leadsRef, 
        where("ownerUid", "==", employeeId),
        where("createdDateKey", ">=", startKey),
        where("createdDateKey", "<=", endKey)
    )),
    getDocs(query(leadsRef, 
        where("ownerUid", "==", employeeId),
        where("lastContactDateKey", ">=", startKey),
        where("lastContactDateKey", "<=", endKey)
    )),
    getDocs(query(leadsRef, 
        where("ownerUid", "==", employeeId),
        where("status", "in", getLeadStatusVariants("closed", "paymentfollowup"))
        // Note: we'll filter by closedAt date in memory because we might not have a closedDateKey index
    ))
  ]);

  // Process Leads
  const assignedCount = createdSnap.size;
  
  // For Call Stats, we need to merge created and contacted leads to ensure we cover all activity
  // Actually, leads contacted in this month should cover all calls made in this month, 
  // UNLESS a call was made but 'lastContactDateKey' was NOT updated (unlikely)
  // OR a call was made early in month, then another call next month (before report gen).
  // If we generate report for Jan in Feb, and lead was called Jan 5 and Feb 2, 
  // lastContactDateKey will be Feb 2. So query for Jan will MISS it.
  // To be 100% accurate, we would need to fetch ALL leads ever assigned to this user.
  // That might be too heavy.
  // COMPROMISE: We fetch leads created in month + leads with lastContactDateKey in month.
  // AND maybe leads created in previous 3-6 months? 
  // For now, let's stick to the query we have, noting the limitation for historical reports.
  // Or, we can fetch 'all leads owned by user' if the count is reasonable.
  // Let's optimize: Fetch leads that are NOT 'closed' or 'cold'?
  // Let's stick to the prompt's implied scope.
  
  // Combine docs for processing calls
  const processedLeadIds = new Set<string>();
  let totalCalls = 0;
  let contactedCount = 0;
  let missedCount = 0;
  
  const processLead = (doc: QueryDocumentSnapshot<DocumentData>) => {
    const data = doc.data() as LeadDoc;
    if (processedLeadIds.has(doc.id)) return;
    processedLeadIds.add(doc.id);
    
    // Funnel stats (based on current status, which might reflect post-month state... 
    // ideally we want state AT END OF MONTH, but Firestore doesn't give time-travel.
    // We'll use current status as best effort).
    const normalizedStatus = normalizeLeadStatus(data.status);
    if (normalizedStatus !== 'new') contactedCount++;
    if (normalizedStatus === 'not_interested' || normalizedStatus === 'wrong_number' || (data.status as string) === 'Missed/Timeout') missedCount++;
    
    // Count calls in target month
    if (data.activityHistory) {
        data.activityHistory.forEach(act => {
            if (act.type === 'contacted' || act.type === 'outgoing_call') {
                const actDate = toDate(act.at);
                if (actDate && actDate >= start && actDate <= end) {
                    totalCalls++;
                }
            }
        });
    }
  };
  
  contactedSnap.docs.forEach(processLead);
  // Also process created leads as they might have been called but lastContactDateKey is not set (unlikely) or different
  createdSnap.docs.forEach(processLead);
  
  // 4. Process Sales
  let totalRevenue = 0;
  let totalSalesCount = 0;
  const closedDeals: ReportData['sales']['deals'] = [];
  
  closedSnap.docs.forEach(d => {
    const data = d.data() as LeadDoc;
    // Check if closed/enrolled in this month
    // We prioritize enrollmentDetails.closedAt, then fallback to updatedAt
    const closedAt = toDate(data.enrollmentDetails?.closedAt || data.updatedAt); 
    
    // Additional Check: Must have enrollment generated or UTR details to be considered revenue
    const hasEnrollment = !!(data.enrollmentDetails?.university && data.enrollmentDetails?.course);
    const hasUTR = !!(data.enrollmentDetails?.utrNumber || data.enrollmentDetails?.emiDetails); // emiDetails sometimes holds UTR in legacy
    
    // If status is PaymentFollowUp, we strictly require enrollment or UTR to count as Sale/Revenue
    // For 'closed' status (legacy), we assume it's a sale.
    // Also verify that the deal was closed by this user (or they are the owner getting credit)
    const isClosedByUser = (data.closedBy?.uid === employeeId) || (data.ownerUid === employeeId);
    
    const normalizedStatus = normalizeLeadStatus(data.status);
    const isValidSale = (
      normalizedStatus === 'closed' ||
      (isPaymentFollowUpStatus(normalizedStatus) && (hasEnrollment || hasUTR))
    ) && isClosedByUser;

    if (isValidSale && closedAt && closedAt >= start && closedAt <= end) {
        totalSalesCount++;
        const fee = Number(data.enrollmentDetails?.fee || data.courseFees || 0);
        totalRevenue += fee;
        
        closedDeals.push({
            clientName: data.name,
            university: data.enrollmentDetails?.university || data.targetUniversity || "N/A",
            course: data.enrollmentDetails?.course || data.targetDegree || "N/A",
            fee: fee,
            date: format(closedAt, "dd MMM yyyy")
        });
    }
  });

  return {
    employeeId: displayEmployeeId,
    employeeName,
    reportMonth: format(targetMonth, "MMMM yyyy"),
    generatedDate: format(new Date(), "dd MMM yyyy"),
    attendance: {
        presentDays,
        absentDays: totalWorkingDays - presentDays, // Simplified
        lateLogins,
        totalWorkingDays,
        attendancePercentage: totalWorkingDays > 0 ? Math.round((presentDays / totalWorkingDays) * 100) : 0
    },
    sales: {
        totalRevenue,
        totalSalesCount,
        deals: closedDeals
    },
    funnel: {
        assigned: assignedCount,
        contacted: contactedCount, // This is approx, based on current status of leads touched/created
        missed: missedCount
    },
    calls: {
        totalCalls
    }
  };
}
