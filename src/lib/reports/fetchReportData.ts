import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getAttendanceDaysForMonth } from "@/lib/firebase/attendance";
import { getLeadStatusVariants, isPaymentFollowUpStatus, normalizeLeadStatus } from "@/lib/leads/status";
import type { LeadDoc } from "@/lib/types/crm";
import { endOfMonth, format, startOfMonth, subDays } from "date-fns";

export type ReportScope = "last_30_days" | "this_month" | "all_time";

export type ReportData = {
  employeeId: string;
  employeeName: string; // Fetch from user doc or pass as prop
  reportTitle: string;
  reportPeriodLabel: string;
  reportMonth: string; // Back-compat label used in file name
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

function toDayStart(value: Date) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDayEnd(value: Date) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

function sanitizeDateRangeEnd(end: Date) {
  const now = new Date();
  return end > now ? now : end;
}

async function resolveEmployeeIdentity(employeeUid: string) {
  let employeeName = "Unknown Employee";
  let displayEmployeeId = employeeUid;
  let joiningDate: Date | null = null;

  try {
    if (!db) throw new Error("Firebase not initialized");
    const snap = await getDoc(doc(db, "users", employeeUid));
    if (snap.exists()) {
      const userData = snap.data() as Record<string, unknown>;
      employeeName = String(userData.displayName ?? userData.email ?? "Employee");
      if (typeof userData.employeeId === "string" && userData.employeeId.trim()) {
        displayEmployeeId = userData.employeeId.trim();
      }
      joiningDate = toDate(userData.joiningDate) ?? toDate(userData.createdAt);
      return { employeeName, displayEmployeeId, joiningDate };
    }
  } catch (e) {
    console.error("Error fetching user (doc)", e);
  }

  try {
    if (!db) throw new Error("Firebase not initialized");
    const userSnap = await getDocs(query(collection(db, "users"), where("uid", "==", employeeUid)));
    if (!userSnap.empty) {
      const userData = userSnap.docs[0].data() as Record<string, unknown>;
      employeeName = String(userData.displayName ?? userData.email ?? "Employee");
      if (typeof userData.employeeId === "string" && userData.employeeId.trim()) {
        displayEmployeeId = userData.employeeId.trim();
      }
      joiningDate = toDate(userData.joiningDate) ?? toDate(userData.createdAt);
    }
  } catch (e) {
    console.error("Error fetching user (query)", e);
  }

  return { employeeName, displayEmployeeId, joiningDate };
}

async function getAttendanceStatsForRange(employeeUid: string, start: Date, end: Date) {
  let presentDays = 0;
  let lateLogins = 0;
  let totalWorkingDays = 0;

  const startBound = toDayStart(start);
  const endBound = toDayEnd(sanitizeDateRangeEnd(end));

  try {
    const cursor = new Date(startBound.getFullYear(), startBound.getMonth(), 1);
    const last = new Date(endBound.getFullYear(), endBound.getMonth(), 1);

    while (cursor <= last) {
      const year = cursor.getFullYear();
      const monthIndex0 = cursor.getMonth();
      const rows = await getAttendanceDaysForMonth(employeeUid, year, monthIndex0);
      rows.forEach((day) => {
        const dateKey = String((day as Record<string, unknown>).dateKey ?? "");
        if (!dateKey) return;
        const inRange = dateKey >= format(startBound, "yyyy-MM-dd") && dateKey <= format(endBound, "yyyy-MM-dd");
        if (!inRange) return;

        const status = String((day as Record<string, unknown>).status ?? "").toLowerCase();
        const dayStatus = String((day as Record<string, unknown>).dayStatus ?? "").toLowerCase();
        const isPresentDay =
          dayStatus === "present" ||
          dayStatus === "late" ||
          status === "checked_in" ||
          status === "checked_out" ||
          status === "on_break" ||
          status === "present";

        if (!isPresentDay) return;

        presentDays += 1;
        const checkedInAt = (day as Record<string, unknown>).checkedInAt;
        if (checkedInAt) {
          const checkIn = toDate(checkedInAt);
          if (checkIn) {
            const threshold = new Date(checkIn);
            threshold.setHours(11, 10, 0, 0);
            if (checkIn > threshold) lateLogins += 1;
          }
        }
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const d = new Date(startBound);
    while (d <= endBound) {
      if (d.getDay() !== 0) totalWorkingDays += 1;
      d.setDate(d.getDate() + 1);
    }
  } catch (e) {
    console.error("Error fetching attendance range", e);
  }

  return { presentDays, lateLogins, totalWorkingDays };
}

async function fetchReportDataForRange(input: {
  employeeUid: string;
  start: Date;
  end: Date;
  reportTitle: string;
  reportPeriodLabel: string;
}): Promise<ReportData> {
  if (!db) throw new Error("Firebase not initialized");

  const start = toDayStart(input.start);
  const end = toDayEnd(sanitizeDateRangeEnd(input.end));
  
  const startKey = format(start, "yyyy-MM-dd");
  const endKey = format(end, "yyyy-MM-dd");

  // 1. Fetch User Details (for name and ID)
  const { employeeName, displayEmployeeId } = await resolveEmployeeIdentity(input.employeeUid);

  // 2. Fetch Attendance
  const { presentDays, lateLogins, totalWorkingDays } = await getAttendanceStatsForRange(
    input.employeeUid,
    start,
    end,
  );

  // 3. Fetch Leads & Sales
  // Strategy:
  // - Assigned: Leads created in date range.
  // - Contacted/Missed/Calls: Leads updated/contacted in date range.
  // - Sales: Leads with status 'closed' and closedAt in date range.
  
  const leadsRef = collection(db, "leads");
  
  // Parallel Queries
  const [createdSnap, contactedSnap, closedSnap] = await Promise.all([
    getDocs(query(leadsRef, 
        where("ownerUid", "==", input.employeeUid),
        where("createdDateKey", ">=", startKey),
        where("createdDateKey", "<=", endKey)
    )),
    getDocs(query(leadsRef, 
        where("ownerUid", "==", input.employeeUid),
        where("lastContactDateKey", ">=", startKey),
        where("lastContactDateKey", "<=", endKey)
    )),
    getDocs(query(leadsRef, 
        where("ownerUid", "==", input.employeeUid),
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
    const isClosedByUser = (data.closedBy?.uid === input.employeeUid) || (data.ownerUid === input.employeeUid);
    
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
    reportTitle: input.reportTitle,
    reportPeriodLabel: input.reportPeriodLabel,
    reportMonth: input.reportPeriodLabel,
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

export async function fetchReportData(employeeUid: string, targetMonth: Date): Promise<ReportData> {
  const start = startOfMonth(targetMonth);
  const end = endOfMonth(targetMonth);
  return fetchReportDataForRange({
    employeeUid,
    start,
    end,
    reportTitle: "Monthly Performance Report",
    reportPeriodLabel: format(targetMonth, "MMMM yyyy"),
  });
}

export async function fetchReportDataForScope(employeeUid: string, scope: ReportScope): Promise<ReportData> {
  const today = new Date();
  const nowBound = toDayEnd(today);

  if (scope === "this_month") {
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);
    return fetchReportDataForRange({
      employeeUid,
      start: monthStart,
      end: sanitizeDateRangeEnd(monthEnd),
      reportTitle: "Monthly Performance Report",
      reportPeriodLabel: format(today, "MMMM yyyy"),
    });
  }

  if (scope === "last_30_days") {
    const start = subDays(nowBound, 30);
    const end = nowBound;
    return fetchReportDataForRange({
      employeeUid,
      start,
      end,
      reportTitle: "Monthly Performance Report",
      reportPeriodLabel: `Last 30 Days (${format(start, "dd MMM yyyy")} - ${format(end, "dd MMM yyyy")})`,
    });
  }

  const { joiningDate } = await resolveEmployeeIdentity(employeeUid);
  const start = joiningDate ? toDayStart(joiningDate) : new Date(2000, 0, 1);
  const end = nowBound;
  return fetchReportDataForRange({
    employeeUid,
    start,
    end,
    reportTitle: "All Time Performance Report",
    reportPeriodLabel: `All Time (${format(start, "dd MMM yyyy")} - ${format(end, "dd MMM yyyy")})`,
  });
}
