"use client";

import { useState, useEffect } from "react";
import { 
  collection, 
  query, 
  where, 
  getCountFromServer, 
  getDocs,
  getDoc,
  doc,
  onSnapshot,
  orderBy,
  Timestamp,
  type QueryDocumentSnapshot,
  type DocumentData
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { UserDoc } from "@/lib/types/user";
import { LeadDoc } from "@/lib/types/crm";
import { startOfDay, startOfWeek, startOfMonth, getWeekOfMonth, isSameMonth } from "date-fns";
import { getTodayKey } from "@/lib/firebase/attendance";
import {
  getLeadStatusBucketVariants,
  getLeadStatusVariants,
  isPaymentFollowUpStatus,
  normalizeLeadStatus,
} from "@/lib/leads/status";
import { getTaskAssignee } from "@/lib/tasks/model";

export type RevenueStats = {
  revenue: number; // 35% of fee
  salesValue: number; // Total fee
  count: number;
};

export type UniversityStat = {
  university: string;
  salesValue: number;
  enrolled: number;
  leads: LeadDoc[];
};

export type DashboardMetrics = {
  totalWorkforce: {
    total: number;
    managers: number;
    teamLeads: number;
    employees: number;
  };
  attendance: {
    present: number;
    total: number;
    percentage: number;
  };
  newHires: {
    count: number;
    recent: Pick<UserDoc, "uid" | "displayName" | "photoURL">[];
  };
  revenue: {
    today: number; 
    month: number; 
    target: number;
    history: { name: string; target: number; revenue: number }[];
    breakdown: {
      today: RevenueStats;
      weekly: RevenueStats;
      monthly: RevenueStats;
      total: RevenueStats;
    };
    universityStats: UniversityStat[];
  };
  leads: {
    new: number;
    contacted: number;
    interested: number;
    closed: number;
  };
  payroll: {
    monthlyBurn: number;
    pendingApprovals: number;
  };
  tasks: {
    completedToday: number;
    assignedToday: number;
  };
};

const initialStats: RevenueStats = { revenue: 0, salesValue: 0, count: 0 };

const initialMetrics: DashboardMetrics = {
  totalWorkforce: { total: 0, managers: 0, teamLeads: 0, employees: 0 },
  attendance: { present: 0, total: 0, percentage: 0 },
  newHires: { count: 0, recent: [] },
  revenue: { 
    today: 0, 
    month: 0, 
    target: 0, 
    history: [],
    breakdown: {
      today: { ...initialStats },
      weekly: { ...initialStats },
      monthly: { ...initialStats },
      total: { ...initialStats },
    },
    universityStats: []
  },
  leads: { new: 0, contacted: 0, interested: 0, closed: 0 },
  payroll: { monthlyBurn: 0, pendingApprovals: 0 },
  tasks: { completedToday: 0, assignedToday: 0 },
};

export function useDashboardMetrics() {
  const { userDoc } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics>(initialMetrics);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || !userDoc) return;
    const firestore = db;
    const currentUser = userDoc;
    
    setLoading(true);

    let unsubTarget: () => void;
    const leadUnsubs: (() => void)[] = [];

    async function init() {
      try {
        const today = new Date();
        const todayTs = Timestamp.fromDate(startOfDay(today));
        const monthStart = startOfMonth(today);
        const startOfMonthTs = Timestamp.fromDate(monthStart);
        const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

        const countLeadStatuses = async (statuses: string[], assignedUid?: string) => {
          const snaps = await Promise.all(
            statuses.map((status) =>
              getCountFromServer(
                query(
                  leadsColl,
                  ...(assignedUid ? [where("assignedTo", "==", assignedUid)] : []),
                  where("status", "==", status),
                ),
              ),
            ),
          );
          return snaps.reduce((sum, snap) => sum + snap.data().count, 0);
        };

        // 1. Workforce Stats (Hierarchical Filtering)
        const usersColl = collection(firestore, "users");
        
        // Fetch ALL users first to build hierarchy in memory
        const allUsersSnap = await getDocs(query(usersColl));
        const allUsers = allUsersSnap.docs.map(d => d.data() as UserDoc);

        // Recursive helper to get all subordinate UIDs
        const getSubordinateUids = (managerId: string): Set<string> => {
          const subs = new Set<string>();
          const directReports = allUsers.filter(u => u.reportsTo === managerId || u.managerId === managerId || u.teamLeadId === managerId);
          
          directReports.forEach(u => {
             if (u.uid !== managerId) { // Prevent self-loop
               subs.add(u.uid);
               const deepSubs = getSubordinateUids(u.uid);
               deepSubs.forEach(ds => subs.add(ds));
             }
          });
          return subs;
        };

        let targetUids = new Set<string>();

        if (currentUser.orgRole === "SUPER_ADMIN") {
           targetUids = new Set(allUsers.map(u => u.uid));
        } else {
           targetUids = getSubordinateUids(currentUser.uid);
           targetUids.add(currentUser.uid);
        }

        const teamUsers = allUsers.filter(u => targetUids.has(u.uid) && (u.status === 'active' || !u.status));
        
        const totalCount = teamUsers.length;
        const managersCount = teamUsers.filter(u => u.orgRole === "MANAGER" || u.role === "manager").length;
        const tlsCount = teamUsers.filter(u => u.orgRole === "TEAM_LEAD" || u.role === "teamLead").length;
        const employeesCount = totalCount - managersCount - tlsCount;
        
        // 2. Attendance (Today)
        const attendanceColl = collection(firestore, "presence");
        const attendanceDocsSnap = await getDocs(query(attendanceColl));

        // 3. New Hires (This Month)
        const newHiresQuery = query(usersColl, where("joinedAt", ">=", startOfMonthTs), orderBy("joinedAt", "desc"));
        const newHiresSnap = await getDocs(newHiresQuery);

        // 4. Lead Funnel Counts (Static for now)
        const leadsColl = collection(firestore, "leads");
        let lNew = 0, lCont = 0, lInt = 0, lClosed = 0;

        try {
            if (currentUser.orgRole === "SUPER_ADMIN") {
                [lNew, lCont, lInt, lClosed] = await Promise.all([
                    countLeadStatuses(getLeadStatusBucketVariants("new")),
                    countLeadStatuses(getLeadStatusBucketVariants("contacted")),
                    countLeadStatuses(getLeadStatusBucketVariants("interested")),
                    countLeadStatuses(getLeadStatusBucketVariants("closed")),
                ]);
            } else {
                // For non-Super Admins, query only assigned leads to avoid permission errors
                [lNew, lCont, lInt, lClosed] = await Promise.all([
                    countLeadStatuses(getLeadStatusBucketVariants("new"), currentUser.uid),
                    countLeadStatuses(getLeadStatusBucketVariants("contacted"), currentUser.uid),
                    countLeadStatuses(getLeadStatusBucketVariants("interested"), currentUser.uid),
                    countLeadStatuses(getLeadStatusBucketVariants("closed"), currentUser.uid),
                ]);
            }
        } catch (err) {
            console.warn("Failed to fetch lead counts", err);
        }

        // 5. Tasks
        const tasksColl = collection(firestore, "tasks");
        const tasksQuery = query(tasksColl, where("updatedAt", ">=", todayTs));
        const tasksDocsPromise = getDocs(tasksQuery);
        const tasksAssignedPromise = getCountFromServer(query(tasksColl, where("createdAt", ">=", todayTs)));
        const [tasksDocsSnap, tAssignSnap] = await Promise.all([tasksDocsPromise, tasksAssignedPromise]);

        // Process Static Data
        const presentCount = attendanceDocsSnap.docs.filter((d: QueryDocumentSnapshot<DocumentData>) => {
          const data = d.data();
          const s = (data.status || "").toLowerCase();
          const recordDateKey = data.dateKey;
          const currentTodayKey = getTodayKey();
          if (recordDateKey !== currentTodayKey) return false;
          if (currentUser.orgRole !== "SUPER_ADMIN") {
             const recordUid = d.id || data.uid || data.userId;
             if (recordUid && !targetUids.has(recordUid)) return false;
          }
          return (
            s === "checked_in" ||
            s === "checked_out" ||
            s === "on_break" ||
            s === "present"
          );
        }).length;
        const attendancePct = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

        const newHiresList = newHiresSnap.docs
            .map((d: QueryDocumentSnapshot<DocumentData>) => d.data() as UserDoc)
            .filter(u => targetUids.has(u.uid))
            .slice(0, 4);

        let monthlyBurn = 0;
        teamUsers.forEach((user: UserDoc) => {
          const u = user as UserDoc & { baseSalary?: unknown; allowance?: unknown };
          const salary = Number(u.baseSalary) || Number(u.salaryStructure?.base) || 0;
          const allowance = Number(u.allowance) || 0; 
            monthlyBurn += (salary + allowance);
        });

        const tasksCompletedCount = tasksDocsSnap.docs.filter(d => {
             const data = d.data() as { status?: string; assignedTo?: string; assigneeUid?: string };
             if (currentUser.orgRole !== "SUPER_ADMIN") {
                const assignee = getTaskAssignee(data);
                if (assignee && !targetUids.has(assignee)) return false;
             }
             return data.status === "completed";
        }).length;

        // UPDATE STATE WITH STATIC DATA FIRST
        setMetrics(prev => ({
            ...prev,
            totalWorkforce: {
                total: totalCount,
                managers: managersCount,
                teamLeads: tlsCount,
                employees: employeesCount,
            },
            attendance: {
                present: presentCount,
                total: totalCount,
                percentage: attendancePct,
            },
            newHires: {
                count: newHiresSnap.size,
                recent: newHiresList,
            },
            leads: {
                new: lNew,
                contacted: lCont,
                interested: lInt,
                closed: lClosed,
            },
            payroll: {
                monthlyBurn: monthlyBurn,
                pendingApprovals: 4, 
            },
            tasks: {
                completedToday: tasksCompletedCount,
                assignedToday: tAssignSnap.data().count,
            }
        }));

        // REALTIME LISTENERS

        // 1. Monthly Target (preflight permission check to avoid console error spam)
        try {
            const targetDocRef = doc(firestore, "settings", "sales_targets");
            const initSnap = await getDoc(targetDocRef);
            let monthlyTarget = 1200000;
            if (initSnap.exists()) {
                const data = initSnap.data();
                if (data[currentMonthKey]) {
                    monthlyTarget = Number(data[currentMonthKey]);
                }
            }
            setMetrics(prev => ({
                ...prev,
                revenue: {
                    ...prev.revenue,
                    target: monthlyTarget
                }
            }));
            unsubTarget = onSnapshot(targetDocRef, (docSnap) => {
                let mt = 1200000;
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data[currentMonthKey]) {
                        mt = Number(data[currentMonthKey]);
                    }
                }
                setMetrics(prev => ({
                    ...prev,
                    revenue: {
                        ...prev.revenue,
                        target: mt
                    }
                }));
            }, (error) => {
                const code = (error as any)?.code;
                if (code === "permission-denied") {
                    setMetrics(prev => ({
                        ...prev,
                        revenue: {
                            ...prev.revenue,
                            target: prev.revenue.target || 1200000
                        }
                    }));
                    return;
                }
                console.error("Monthly target listener error", error);
            });
        } catch (error) {
            const code = (error as any)?.code;
            if (code === "permission-denied") {
                setMetrics(prev => ({
                    ...prev,
                    revenue: {
                        ...prev.revenue,
                        target: prev.revenue.target || 1200000
                    }
                }));
            } else {
                console.error("Monthly target init error", error);
            }
        }

        // 2. Revenue Leads (Closed & PF)
        // Store all leads in a map to handle multiple listeners updates
        const allLeadsMap = new Map<string, DocumentData>();
        
        const updateMetricsFromLeads = () => {
            const stats = {
                today: { revenue: 0, salesValue: 0, count: 0 },
                weekly: { revenue: 0, salesValue: 0, count: 0 },
                monthly: { revenue: 0, salesValue: 0, count: 0 },
                total: { revenue: 0, salesValue: 0, count: 0 },
            };

            const historyMap = new Map<string, number>();
            for (let i = 1; i <= 5; i++) historyMap.set(`Week ${i}`, 0);
            
            const uniMap = new Map<string, { university: string; salesValue: number; enrolled: number; leads: LeadDoc[] }>();

            const now = new Date();
            const todayStart = startOfDay(now);
            const weekStart = startOfWeek(now, { weekStartsOn: 1 });
            const currentMonthStart = startOfMonth(now);

            allLeadsMap.forEach((data, docId) => {
                const status = normalizeLeadStatus(data.status);
                const subStatus = (data.subStatus || "").toLowerCase().trim();
                
                let salesValue = 0;
                let isValid = false;
                let date: Date | null = null;

                // Prioritize enrollmentDetails.fee > courseFees > amount
                // Also handle string/number conversion and comma removal
                const rawFee = data.enrollmentDetails?.fee ?? data.courseFees ?? data.amount ?? data.fee ?? 0;
                let parsedFee = typeof rawFee === 'string' ? Number(rawFee.replace(/[^0-9.]/g, '')) : Number(rawFee);
                if (isNaN(parsedFee)) parsedFee = 0;

                const reason = (data.statusDetail?.currentReason || "").toLowerCase().trim();
                
                // Check if lead is a valid revenue lead (PaymentFollowUp OR Closed OR Converted with specific reasons)
                // We check both Status and SubStatus/Reason because "Closed" leads might be valid enrollments
                // "Converted" status is also treated as a valid sale
                // AND fallback: If enrollmentDetails.fee exists and > 0, it's a sale (Safety Net)
                const hasValidEnrollmentDetails = !!data.enrollmentDetails && Number(data.enrollmentDetails.fee) > 0;

                if (
                    hasValidEnrollmentDetails ||
                    status === "converted" ||
                    (
                        (isPaymentFollowUpStatus(status) || status === "closed") && 
                        (
                            subStatus === "enrollment generated" || 
                            subStatus === "utr details" || 
                            subStatus === "utr (loan details)" ||
                            reason === "enrollment generated" ||
                            reason === "utr details (loan details)" ||
                            reason === "utr (loan details)"
                        )
                    )
                ) {
                    salesValue = parsedFee;
                    
                    // Use closedAt for closed/converted leads if available, otherwise updatedAt
                    if ((status === "closed" || status === "converted") && data.closedAt) {
                        date = data.closedAt.toDate();
                    } else if (data.updatedAt) {
                        date = data.updatedAt.toDate();
                    } else if (data.createdAt) {
                        date = data.createdAt.toDate();
                    }
                    
                    isValid = true;
                }

                if (isValid && date) {
                    const revenue = salesValue * 0.35;
                    
                    // Total
                    stats.total.revenue += revenue;
                    stats.total.salesValue += salesValue;
                    stats.total.count += 1;

                    // Today
                    if (date >= todayStart) {
                        stats.today.revenue += revenue;
                        stats.today.salesValue += salesValue;
                        stats.today.count += 1;
                    }

                    // Weekly
                    if (date >= weekStart) {
                        stats.weekly.revenue += revenue;
                        stats.weekly.salesValue += salesValue;
                        stats.weekly.count += 1;
                    }

                    // Monthly
                    if (date >= currentMonthStart) {
                        stats.monthly.revenue += revenue;
                        stats.monthly.salesValue += salesValue;
                        stats.monthly.count += 1;

                        // Add to History (Weekly breakdown)
                        if (isSameMonth(date, now)) {
                             const weekNum = getWeekOfMonth(date);
                             const key = `Week ${weekNum}`;
                             historyMap.set(key, (historyMap.get(key) || 0) + salesValue);
                        }
                    }

                    // University Stats (Calculate for ALL timeframes, not just this month)
                    const uniName = (
                        data.enrollmentDetails?.university || 
                        data.targetUniversity || 
                        data.university || 
                        data.college || 
                        data.institution || 
                        "Unknown"
                    ).trim() || "Unknown";
                    const prevUni = uniMap.get(uniName) || { university: uniName, salesValue: 0, enrolled: 0, leads: [] as LeadDoc[] };
                    prevUni.salesValue += salesValue;
                    prevUni.enrolled += 1;
                    prevUni.leads.push({ ...data, leadId: docId } as LeadDoc);
                    uniMap.set(uniName, prevUni);
                }
            });

            // Convert Uni Map to List
            const universityStats = Array.from(uniMap.values())
                .sort((a, b) => b.salesValue - a.salesValue);

            setMetrics(prev => {
                const currentTarget = prev.revenue.target || 1200000;
                const weeklyTarget = currentTarget / 4;

                const history = Array.from(historyMap.entries())
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([name, val]) => ({
                        name,
                        target: Math.round(weeklyTarget),
                        revenue: val 
                    }));

                return {
                    ...prev,
                    revenue: {
                        ...prev.revenue,
                        today: stats.today.revenue,
                        month: stats.monthly.revenue,
                        breakdown: stats,
                        history: history,
                        universityStats: universityStats
                    }
                };
            });
            setLoading(false);
        };

        // Create listeners based on role/hierarchy
        if (currentUser.orgRole === "SUPER_ADMIN") {
             const q = query(
                leadsColl,
                where("status", "in", getLeadStatusVariants("closed", "converted", "paymentfollowup")),
            );
            const unsub = onSnapshot(q, (snap) => {
                snap.docChanges().forEach((change) => {
                    if (change.type === "removed") {
                        allLeadsMap.delete(change.doc.id);
                    } else {
                        allLeadsMap.set(change.doc.id, change.doc.data());
                    }
                });
                updateMetricsFromLeads();
            }, (error) => {
                console.error("Revenue leads listener error", error);
                setLoading(false);
            });
            leadUnsubs.push(unsub);
        } else {
             // For Managers/TLs, we must listen to each subordinate individually 
             // We CANNOT use 'in' for both assignedTo and status in the same query.
             // So we iterate through each UID and create a listener with status 'in' query.
             const uidsToListen = Array.from(targetUids);
             
             for (const uid of uidsToListen) {
                 const q = query(
                    leadsColl, 
                    where("assignedTo", "==", uid),
                    where("status", "in", getLeadStatusVariants("closed", "converted", "paymentfollowup"))
                 );
                 
                 const unsub = onSnapshot(q, (snap) => {
                    snap.docChanges().forEach((change) => {
                        if (change.type === "removed") {
                            allLeadsMap.delete(change.doc.id);
                        } else {
                            allLeadsMap.set(change.doc.id, change.doc.data());
                        }
                    });
                    updateMetricsFromLeads();
                 }, (error) => {
                     // Permission denied might happen if a user was removed/changed roles
                     console.warn(`Leads listener warning for uid ${uid}`, error);
                 });
                 leadUnsubs.push(unsub);
             }
             
             // If no Uids (shouldn't happen as we include self), stop loading
             if (uidsToListen.length === 0) setLoading(false);
        }

      } catch (e) {
        console.error("Failed to init dashboard metrics", e);
        setError("Failed to load metrics");
        setLoading(false);
      }
    }

    init();

    return () => {
        leadUnsubs.forEach(unsub => unsub());
        if (unsubTarget) unsubTarget();
    };
  }, [userDoc]);

  return { metrics, loading, error };
}
