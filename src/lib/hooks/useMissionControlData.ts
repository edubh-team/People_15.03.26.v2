import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, orderBy, limit, Timestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { UserDoc } from "@/lib/types/user";
import type { LeadDoc } from "@/lib/types/crm";
import { startOfDay, startOfWeek, startOfMonth } from "date-fns";
import { getTodayKey } from "@/lib/firebase/attendance";
import { toDateSafe as toDate } from "@/lib/attendance-utils";
import type { PresenceDoc } from "@/lib/types/attendance";
import { isPaymentFollowUpStatus, normalizeLeadStatus } from "@/lib/leads/status";

type AuditLog = {
  id: string;
  action: string;
  details: string;
  performedBy: string; // usually a role or name or uid? In audit.ts it is "performedBy" string.
  timestamp: Timestamp;
};

export type OrgNode = UserDoc & {
  children: OrgNode[];
  directReportsCount: number;
};

export type ActivityDoc = {
  id: string;
  type: string;
  description?: string;
  timestamp: Date;
  user?: {
    uid: string;
    displayName?: string | null;
    photoURL?: string | null;
  };
  details?: Record<string, unknown>;
};

export type RevenueStats = {
  revenue: number; // 35% of fee
  salesValue: number; // Total fee
  count: number;
};

export type PipelineMetrics = {
  totalVolume: number;
  // Legacy fields (kept for compatibility if used elsewhere, mapped to 'total')
  pipelineValue: number; 
  totalEnrolledValue: number;
  totalEnrolledCount: number;
  
  revenueBreakdown: {
    today: RevenueStats;
    weekly: RevenueStats;
    monthly: RevenueStats;
    total: RevenueStats;
  };

  funnelBreakdown: Array<{ name: string; value: number }>;
  winRate: number;
  leadVelocity: number;
  unclosedLeads: number;
  closedLeads: number;
  enrollmentGeneratedCount: number; // New field for "PaymentFollowUp" + "Enrollment Generated"/"UTR Details"
  universityBreakdown: Array<{
    name: string;
    revenue: number;
    salesValue: number;
    count: number;
    leads: LeadDoc[];
  }>;
  punchedLeads: number;
  activeUsers: number;
  presentUsers: number;
  onTimeUsers: number;
};

import { isRevenueLead } from "@/lib/utils/leadLogic";

export function useMissionControlData() {
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [leads, setLeads] = useState<LeadDoc[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityDoc[]>([]);
  const [presenceDocs, setPresenceDocs] = useState<PresenceDoc[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
      setTimeout(() => {
        setError("Firebase not initialized");
        setLoading(false);
      }, 0);
      return;
    }

    // 1. Fetch Users (Filter out Terminated)
    const qUsers = query(collection(db, "users"));
    const unsubUsers = onSnapshot(
      qUsers,
      (snapshot) => {
        const data = snapshot.docs
          .map((d) => ({ ...d.data(), uid: d.id } as UserDoc))
          .filter(u => (u.status as string) !== 'Terminated'); // Strict Filter
        setUsers(data);
      },
      (err) => {
        console.error("Error fetching users:", err);
        setError("Failed to load organization data");
      }
    );

    // 2. Fetch Leads
    const qLeads = query(collection(db, "leads"));
    const unsubLeads = onSnapshot(
      qLeads,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ ...d.data(), leadId: d.id } as LeadDoc));
        setLeads(data);
        setLoading(false); // Assume loaded when both streams emit at least once
      },
      (err) => {
        console.error("Error fetching leads:", err);
        setError("Failed to load pipeline data");
        setLoading(false);
      }
    );



  // ... (Refactor needed below)


    // 4. Fetch Presence (Today)
    const todayKey = getTodayKey();
    const qPresence = query(collection(db, "presence"), where("dateKey", "==", todayKey));
    const unsubPresence = onSnapshot(
      qPresence,
      (snapshot) => {
        const data = snapshot.docs.map((d) => d.data() as PresenceDoc);
        setPresenceDocs(data);
      },
      (err) => {
        console.error("Error fetching presence:", err);
      }
    );

    // 5. Fetch Audit Logs (Recent 50)
    const qAudit = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(50));
    const unsubAudit = onSnapshot(
        qAudit,
        (snapshot) => {
            const data = snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as AuditLog));
            setAuditLogs(data);
        },
        (err) => {
            console.error("Error fetching audit logs:", err);
        }
    );

    return () => {
      unsubUsers();
      unsubLeads();
      unsubPresence();
      unsubAudit();
    };
  }, []);

  // 5. Synthesize Activity Feed (Merge DB Activities + Derived Events)
  useEffect(() => {
    if (loading) return;

    const derivedActivities: ActivityDoc[] = [];

    // A. Attendance (Today)
    presenceDocs.forEach(p => {
        if (p.checkedInAt) {
            const u = users.find(u => u.uid === p.uid);
            if (u) {
                derivedActivities.push({
                    id: `presence-${p.uid}`,
                    type: 'attendance',
                    description: 'checked in for the day',
                    timestamp: toDate(p.checkedInAt),
                    user: {
                        uid: u.uid,
                        displayName: u.displayName,
                        photoURL: u.photoURL
                    }
                });
            }
        }
    });

    // B. Sales / Enrollments (Recent from Leads)
    // Optimization: Only check leads updated recently? 
    // For now, iterate all leads but only take recent history/enrollments
    const now = new Date();
    const lookbackWindow = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000); // 4 Days

    leads.forEach(lead => {
        // 1. New Lead Created
        if (lead.createdAt) {
            const createdAt = toDate(lead.createdAt);
            if (createdAt > lookbackWindow) {
                derivedActivities.push({
                    id: `new-lead-${lead.leadId}`,
                    type: 'new_lead',
                    description: `new lead created: ${lead.name}`,
                    timestamp: createdAt,
                    user: {
                        uid: lead.createdBy?.uid || 'system',
                        displayName: lead.createdBy?.name || 'System'
                    }
                });
            }
        }

        // 2. Enrollment
        if (lead.enrollmentDetails?.closedAt) {
            const closedAt = toDate(lead.enrollmentDetails.closedAt);
            if (closedAt > lookbackWindow) {
                derivedActivities.push({
                    id: `enrollment-${lead.leadId}`,
                    type: 'sale',
                    description: `closed a sale for ${lead.enrollmentDetails.course} (${lead.enrollmentDetails.university})`,
                    timestamp: closedAt,
                    user: {
                        uid: lead.ownerUid || 'system',
                        displayName: lead.closedBy?.name || 'Unknown Agent'
                    },
                    details: {
                        amount: lead.enrollmentDetails.fee
                    }
                });
            }
        }

        // 3. Recent History (Status Changes)
        if (lead.history) {
            lead.history.forEach((h, idx) => {
                const hDate = toDate(h.timestamp);
                if (hDate > lookbackWindow) {
                    // Filter interesting events
                    if (normalizeLeadStatus(h.newStatus) === 'closed' || isPaymentFollowUpStatus(h.newStatus) || h.action === 'Refund Initiated') {
                        derivedActivities.push({
                            id: `history-${lead.leadId}-${idx}`,
                            type: 'status_change',
                            description: `updated lead ${lead.name} to ${h.newStatus}`,
                            timestamp: toDate(h.timestamp),
                            user: {
                                uid: h.updatedBy,
                                displayName: h.updatedByName
                            }
                        });
                    }
                }
            });
        }
    });

    // C. User Logins (Recent)
    users.forEach(u => {
        if (u.lastLogin) {
            const loginDate = toDate(u.lastLogin);
            if (loginDate > lookbackWindow) {
                derivedActivities.push({
                    id: `login-${u.uid}`,
                    type: 'login',
                    description: 'logged into the system',
                    timestamp: loginDate,
                    user: {
                        uid: u.uid,
                        displayName: u.displayName,
                        photoURL: u.photoURL
                    }
                });
            }
        }
    });

    // D. System Audit Logs
    auditLogs.forEach(log => {
        const logDate = toDate(log.timestamp);
        if (logDate > lookbackWindow) {
            // Avoid duplicates if we already covered it (e.g. lead status change might be logged twice)
            // But audit logs have different IDs, so we keep them if they provide unique value.
            // Filter out LOGIN actions as we already use users.lastLogin (which is more accurate for "current state")
            if (log.action === 'LOGIN' || log.action === 'LEAD_STATUS_CHANGE') return;

            derivedActivities.push({
                id: `audit-${log.id}`,
                type: 'system_audit', // New type
                description: `${log.action}: ${log.details}`,
                timestamp: logDate,
                user: {
                    uid: 'system', // Audit logs might store "SUPER_ADMIN" or name in performedBy
                    displayName: log.performedBy
                }
            });
        }
    });

    // Sort by timestamp descending
    derivedActivities.sort((a, b) => {
        return b.timestamp.getTime() - a.timestamp.getTime();
    });

    setActivityFeed(derivedActivities);

  }, [leads, users, presenceDocs, auditLogs, loading]);

  // Build Org Tree
  const treeData = useMemo(() => {
    if (!users.length) return [];
    return buildOrgTree(users);
  }, [users]);

  // Calculate Pipeline Metrics
  const pipelineStats = useMemo(() => {
    if (!leads.length && !users.length) return null;
    return calculatePipelineMetrics(leads, users, presenceDocs);
  }, [leads, users, presenceDocs]);

  // Return leads as well so Mission Control Page can use them for filtering
  return { treeData, pipelineStats, activityFeed, loading, error, leads };
}

// ...

function calculatePipelineMetrics(leads: LeadDoc[], users: UserDoc[], presenceDocs: PresenceDoc[]): PipelineMetrics {
  // ... (activeUserIds, activeLeads omitted) ...
  const activeUserIds = new Set(users.map(u => u.uid));

  // Filter leads: Exclude leads owned/assigned to Terminated users (users NOT in activeUserIds)
  // Keep unassigned leads (where owner/assigned is null)
  const activeLeads = leads.filter(lead => {
    const ownerId = lead.ownerUid || lead.assignedTo;
    if (!ownerId) return true; // Keep unassigned
    return activeUserIds.has(ownerId);
  });

  const totalVolume = activeLeads.length;

  const stats = {
    today: { revenue: 0, salesValue: 0, count: 0 },
    weekly: { revenue: 0, salesValue: 0, count: 0 },
    monthly: { revenue: 0, salesValue: 0, count: 0 },
    total: { revenue: 0, salesValue: 0, count: 0 },
  };

  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday start
  const monthStart = startOfMonth(now);

  // Iterate over ALL leads for Revenue/Enrollment stats to include historical data from terminated users
  leads.forEach((lead) => {
    const isEnrolled = isRevenueLead(lead);
    
    if (isEnrolled) {
      const rawFee = lead.enrollmentDetails?.fee || lead.courseFees || 0;
      const fee = Number(rawFee) || 0; // Ensure it's a number
      const revenue = fee * 0.35;

      // Determine the date of the sale/enrollment
      // Prioritize enrollmentDetails.closedAt, then top-level closedAt, then updatedAt
      let date: Date | null = null;
      const dateVal = lead.enrollmentDetails?.closedAt || lead.closedAt || lead.updatedAt;

      if (dateVal) {
        if (dateVal instanceof Timestamp) date = dateVal.toDate();
        else if (typeof dateVal === 'string') date = new Date(dateVal);
        else if (dateVal instanceof Date) date = dateVal;
        else if (typeof dateVal === 'object' && dateVal !== null && 'toDate' in dateVal) {
             date = (dateVal as { toDate: () => Date }).toDate();
        }
      }

      // Always add to total
      stats.total.revenue += revenue;
      stats.total.salesValue += fee;
      stats.total.count++;

      if (date) {
        if (date >= todayStart) {
            stats.today.revenue += revenue;
            stats.today.salesValue += fee;
            stats.today.count++;
        }
        if (date >= weekStart) {
            stats.weekly.revenue += revenue;
            stats.weekly.salesValue += fee;
            stats.weekly.count++;
        }
        if (date >= monthStart) {
            stats.monthly.revenue += revenue;
            stats.monthly.salesValue += fee;
            stats.monthly.count++;
        }
      }
    }
  });

  // Legacy variables for backward compatibility
  const totalEnrolledValue = stats.total.salesValue;
  const totalEnrolledCount = stats.total.count;
  const pipelineValue = stats.total.revenue;

  // Status counts
  // Map actual statuses to funnel stages
  // Statuses: "new" | "hot" | "warm" | "followup" | "cold" | "closed"
  
  const funnelMap: Record<string, number> = {
    New: 0,
    Contacted: 0,
    Proposal: 0,
    Won: 0,
  };

  let closedWon = 0;
  let closedTotal = 0; // Total closed (Won + Lost)
  let enrollmentGeneratedCount = 0;
  let newLeadsToday = 0;
  let unclosedLeads = 0;

  const universityMap = new Map<string, { revenue: number; salesValue: number; count: number; leads: LeadDoc[] }>();

  // Use ALL leads for enrollment counts to catch historical data
  leads.forEach((lead) => {
    const s = normalizeLeadStatus(lead.status);
    const sub = (lead.subStatus || "").toLowerCase();
    
    // Use centralized logic for revenue/enrollment identification
    // This ensures consistency with the top-level Revenue Stats and includes 
    // PaymentFollowUp, Closed, Converted, and Safety Net leads.
    if (isRevenueLead(lead)) {
        enrollmentGeneratedCount++;

        // University Logic
        const uniName = lead.enrollmentDetails?.university || "Unknown University";
        const rawFee = (lead.enrollmentDetails?.fee || lead.courseFees || 0) as unknown;
        let fee = 0;
        if (typeof rawFee === 'string') {
          fee = Number(rawFee.replace(/[^0-9.]/g, ''));
        } else if (typeof rawFee === 'number') {
          fee = rawFee;
        }
        if (isNaN(fee)) fee = 0;
        
        const revenue = fee * 0.35; // Assuming 35% margin logic

        const current = universityMap.get(uniName) || { revenue: 0, salesValue: 0, count: 0, leads: [] };
        universityMap.set(uniName, {
            revenue: current.revenue + revenue,
            salesValue: current.salesValue + fee,
            count: current.count + 1,
            leads: [...(current.leads || []), lead]
        });
    }
  });

  const universityBreakdown = Array.from(universityMap.entries()).map(([name, stats]) => ({
      name,
      ...stats
  })).sort((a, b) => b.revenue - a.revenue);

  // Use Active Leads for Funnel/Velocity (current operational view)
  activeLeads.forEach((lead) => {
    const s = (lead.status || "new").toLowerCase();
    
    // Count Unclosed & Closed
    if (s === "closed" || s === "converted" || s === "not_interested") {
      closedTotal++;
    } else {
      unclosedLeads++;
    }

    // Funnel Categories
    if (s === "new") funnelMap.New++;
    else if (["ringing", "followup", "not_interested", "wrong_number"].includes(s)) funnelMap.Contacted++;
    else if (s === "interested") funnelMap.Proposal++;
    else if (s === "closed") {
       funnelMap.Won++;
       // closedTotal already counted above
       closedWon++; 
    }

    // Lead Velocity (Created Today)
    if (lead.createdAt) {
       let d: Date | null = null;
       if (lead.createdAt instanceof Timestamp) {
          d = lead.createdAt.toDate();
       } else if (typeof lead.createdAt === 'object' && 'toDate' in lead.createdAt) {
          // Handle object that looks like a Timestamp but isn't an instance
          d = (lead.createdAt as { toDate: () => Date }).toDate();
       } else if (lead.createdAt instanceof Date) {
          d = lead.createdAt;
       } else if (typeof lead.createdAt === 'string') {
          d = new Date(lead.createdAt);
       }

       if (d) {
          if (d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
             newLeadsToday++;
          }
       }
    }
  });

  const winRate = closedTotal > 0 ? (closedWon / closedTotal) * 100 : 0;
  const punchedLeads = totalVolume - funnelMap.New;

  const funnelBreakdown = [
    { name: "New", value: funnelMap.New },
    { name: "Contacted", value: funnelMap.Contacted },
    { name: "Proposal", value: funnelMap.Proposal },
    { name: "Won", value: funnelMap.Won },
  ];

  const activeUsers = users.filter(u => u.isActive || u.status === 'active').length;

  const presentUsers = presenceDocs.filter(p => p.status !== 'on_leave').length;
  const onTimeUsers = presenceDocs.filter(p => p.dayStatus === 'present').length;

  return {
    totalVolume,
    winRate,
    pipelineValue,
    totalEnrolledValue,
    totalEnrolledCount,
    revenueBreakdown: stats,
    funnelBreakdown,
    leadVelocity: newLeadsToday,
    unclosedLeads,
    closedLeads: closedTotal,
    enrollmentGeneratedCount,
    universityBreakdown,
    punchedLeads,
    activeUsers,
    presentUsers,
    onTimeUsers
  };
}

function buildOrgTree(users: UserDoc[]): OrgNode[] {
  const nodeMap = new Map<string, OrgNode>();
  
  // 1. Create Nodes
  users.forEach(u => {
    nodeMap.set(u.uid, {
      ...u,
      children: [],
      directReportsCount: 0
    });
  });

  const roots: OrgNode[] = [];

  // 2. Link Nodes
  nodeMap.forEach(node => {
    // Priority: reportsTo -> managerId -> teamLeadId (optional fallback)
    // Using reportsTo as primary hierarchy field
    const parentId = node.reportsTo || node.managerId;
    
    if (parentId && nodeMap.has(parentId)) {
      const parent = nodeMap.get(parentId)!;
      parent.children.push(node);
      parent.directReportsCount += 1;
    } else {
      roots.push(node);
    }
  });

  return roots;
}
