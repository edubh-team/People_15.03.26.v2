"use client";

import { useState, useEffect, Fragment, useMemo } from "react";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  writeBatch, 
  serverTimestamp,
  getDocs,
  getDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useParams } from "next/navigation";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  Legend
} from "recharts";
import { 
    ArrowPathIcon, 
    UserGroupIcon, 
    PhoneIcon, 
    ClockIcon,
    CheckCircleIcon,
    CalendarDaysIcon,
    ExclamationCircleIcon,
    BanknotesIcon
  } from "@heroicons/react/24/outline";
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import { format, subDays, isBefore } from "date-fns";
import { useAttendanceMonth, useHolidaysMonth } from "@/lib/hooks/useAttendance";
import AttendanceCalendarModal from "@/components/team/AttendanceCalendarModal";
import DownloadReportButton from "@/components/reports/DownloadButton";
import { isPaymentFollowUpStatus, normalizeLeadStatus } from "@/lib/leads/status";
import { getTaskLeadIntegrity, normalizeTaskDoc } from "@/lib/tasks/model";

// Types
import type { LeadDoc } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";

// Colors for charts
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];
const STATUS_COLORS: Record<string, string> = {
  new: '#3B82F6', // blue-500
  interested: '#EF4444', // red-500
  ringing: '#6366F1', // indigo-500
  followup: '#8B5CF6', // violet-500
  not_interested: '#64748B', // slate-500
  wrong_number: '#94A3B8', // slate-400
  paymentfollowup: '#F59E0B', // amber-500
  converted: '#10B981', // emerald-500
  closed: '#10B981', // emerald-500
};

type Metrics = {
  totalAssigned: number;
  contacted: number;
  avgAttempts: number;
  conversion: number;
  statusDistribution: { name: string; value: number }[];
  dailyActivity: { date: string; calls: number }[];
};

export default function EmployeeReportPage() {
  const params = useParams();
  const employeeId = params?.employeeId as string;
  
  const [employee, setEmployee] = useState<UserDoc | null>(null);
  
  // Attendance State & Data
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  
  const { data: attendanceData } = useAttendanceMonth(employeeId, currentYear, currentMonth);
  const { data: holidaysData } = useHolidaysMonth(currentYear, currentMonth);

  const attendanceStats = useMemo(() => {
    const stats = {
      present: 0,
      leave: 0,
      absent: 0,
      holidays: holidaysData?.length || 0
    };

    if (!attendanceData) return stats;

    attendanceData.forEach(day => {
       if (day.status === 'checked_in' || day.status === 'checked_out') {
          if (day.dayStatus === 'on_leave') stats.leave++;
          else stats.present++;
       } else if (day.status === 'on_leave' || day.dayStatus === 'on_leave') {
          stats.leave++;
       }
       // 'absent' isn't explicitly tracked in this simple model, 
       // typically inferred from working days - (present + leave + holidays)
    });

    return stats;
  }, [attendanceData, holidaysData]);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [unattendedLeads, setUnattendedLeads] = useState<LeadDoc[]>([]);
  const [allLeads, setAllLeads] = useState<LeadDoc[]>([]);
  const [targetAgent, setTargetAgent] = useState('');
  const [subordinates, setSubordinates] = useState<UserDoc[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [isShuffleModalOpen, setIsShuffleModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [convertedLeads, setConvertedLeads] = useState<LeadDoc[]>([]);
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const [taskLinkHealth, setTaskLinkHealth] = useState({ linked: 0, orphaned: 0, ownerMismatch: 0 });

  const filteredLeads = useMemo(() => {
    if (statusFilter === 'all') return allLeads;
    return allLeads.filter(lead => (lead.status || 'new') === statusFilter);
  }, [allLeads, statusFilter]);

  // 1. Fetch Employee Details
  useEffect(() => {
    if (!employeeId) return;
    
    const fetchEmployee = async () => {
      if (!db) return;
      const userRef = doc(db, 'users', employeeId);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        setEmployee({ uid: userSnap.id, ...userSnap.data() } as UserDoc);
      }
    };
    
    fetchEmployee();
  }, [employeeId]);

  useEffect(() => {
    if (!employeeId || !db) return;
    const firestore = db as NonNullable<typeof db>;

    let active = true;
    async function loadTaskLinkHealth() {
      try {
        const [assignedSnap, legacySnap] = await Promise.all([
          getDocs(query(collection(firestore, 'tasks'), where('assignedTo', '==', employeeId))),
          getDocs(query(collection(firestore, 'tasks'), where('assigneeUid', '==', employeeId))),
        ]);

        const taskMap = new Map<string, ReturnType<typeof normalizeTaskDoc<Record<string, unknown>>>>();
        [...assignedSnap.docs, ...legacySnap.docs].forEach((row) => {
          taskMap.set(row.id, normalizeTaskDoc(row.data() as Record<string, unknown>, row.id));
        });

        const linkedTasks = Array.from(taskMap.values()).filter((task) => Boolean(task.leadId));
        const leadIds = Array.from(new Set(linkedTasks.map((task) => task.leadId).filter((leadId): leadId is string => Boolean(leadId))));
        const leadEntries = await Promise.all(
          leadIds.map(async (leadId) => {
            const leadSnap = await getDoc(doc(firestore, 'leads', leadId));
            return [leadId, leadSnap.exists() ? ({ ...(leadSnap.data() as LeadDoc), leadId: leadSnap.id } as LeadDoc) : null] as const;
          }),
        );
        const leadMap = new Map<string, LeadDoc | null>(leadEntries);

        let linked = 0;
        let orphaned = 0;
        let ownerMismatch = 0;
        linkedTasks.forEach((task) => {
          const integrity = getTaskLeadIntegrity(task, task.leadId ? (leadMap.get(task.leadId) ?? null) : null);
          if (integrity === 'linked') linked += 1;
          if (integrity === 'orphaned') orphaned += 1;
          if (integrity === 'owner_mismatch') ownerMismatch += 1;
        });

        if (active) {
          setTaskLinkHealth({ linked, orphaned, ownerMismatch });
        }
      } catch (error) {
        console.error('Failed to load task link health', error);
        if (active) setTaskLinkHealth({ linked: 0, orphaned: 0, ownerMismatch: 0 });
      }
    }

    void loadTaskLinkHealth();
    return () => {
      active = false;
    };
  }, [employeeId]);

  // 2. Fetch Subordinates (for shuffle target)
  useEffect(() => {
    // Only fetch if we have the current user context (implementation omitted for brevity, assuming context exists)
    // For now, let's fetch all active users who are not the current employee
    const fetchSubordinates = async () => {
      if (!db) return;
      const q = query(
        collection(db, 'users'), 
        where('status', '==', 'active')
      );
      const snap = await getDocs(q);
      const users = snap.docs
        .map(d => ({ uid: d.id, ...d.data() } as UserDoc))
        .filter(u => u.uid !== employeeId); // Exclude current employee
      setSubordinates(users);
    };
    
    fetchSubordinates();
  }, [employeeId]);

  // 3. Real-time Data Aggregation
  useEffect(() => {
    if (!employeeId || !db) return;

    const leadsRef = collection(db, 'leads');
    
    let assignedDocs: LeadDoc[] = [];
    let closedDocs: LeadDoc[] = [];
    let loadedAssigned = false;
    let loadedClosed = false;

    // Helper to process merged leads
    const processLeads = () => {
        if (!loadedAssigned || !loadedClosed) return;

        // Merge and Deduplicate
        const leadMap = new Map<string, LeadDoc>();
        assignedDocs.forEach(l => leadMap.set(l.leadId, l));
        closedDocs.forEach(l => leadMap.set(l.leadId, l));
        const leads = Array.from(leadMap.values());

        // Sort by lastActionAt desc
        leads.sort((a, b) => {
            const getTime = (val: unknown) => {
            if (val instanceof Timestamp) return val.toMillis();
            if (typeof val === 'string' || typeof val === 'number') return new Date(val).getTime();
            return 0;
            };
            // Priority: lastActionAt -> updatedAt -> createdAt
            const tA = getTime(a.lastActionAt) || getTime(a.updatedAt) || getTime(a.createdAt);
            const tB = getTime(b.lastActionAt) || getTime(b.updatedAt) || getTime(b.createdAt);
            return tB - tA;
        });
        
        // A. Calculate Metrics
        let totalCalls = 0;
        let contactedCount = 0;
        let convertedCount = 0;
        const statusCounts: Record<string, number> = {};
        const activityMap: Record<string, number> = {};
        const unattended: LeadDoc[] = [];
        const converted: LeadDoc[] = [];
        const sevenDaysAgo = subDays(new Date(), 7);

        setAllLeads(leads); // Update all leads state for portfolio view

        leads.forEach(lead => {
            // Status Distribution
            const status = normalizeLeadStatus(lead.status);
            statusCounts[status] = (statusCounts[status] || 0) + 1;

            // Activity Metrics
            const activityHistory = lead.activityHistory || [];
            const callCount = activityHistory.filter(a => a.type === 'contacted').length; 
            const attempts = callCount > 0 ? callCount : (lead.history?.length || 0); 
            
            totalCalls += attempts;
            if (status !== 'new') contactedCount++;
            
            // Calculate Conversion:
            const isClosedStatus = status === 'closed';
            const isPaymentEnrollment = isPaymentFollowUpStatus(status) && 
                (lead.subStatus === 'Enrollment Generated' || lead.subStatus === 'UTR (Loan Details)' || lead.subStatus === 'UTR Details' || !!lead.enrollmentDetails);
            
            const isClosedByThisUser = lead.closedBy?.uid === employeeId || 
                (lead.isSelfGenerated && lead.createdBy?.uid === employeeId);

            if ((isClosedStatus || isPaymentEnrollment) && isClosedByThisUser) {
                convertedCount++;
                converted.push(lead);
            }

            // Daily Activity (last 7 days)
            activityHistory.forEach(activity => {
                if (activity.at) {
                    let date: Date;
                    if (activity.at instanceof Timestamp) date = activity.at.toDate();
                    else if (typeof activity.at === 'string') date = new Date(activity.at);
                    else return; 

                    const dateKey = format(date, 'MMM dd');
                    activityMap[dateKey] = (activityMap[dateKey] || 0) + 1;
                }
            });

            // Unattended Logic
            let lastActionDate: Date | null = null;
            if (lead.updatedAt) {
                if (lead.updatedAt instanceof Timestamp) lastActionDate = lead.updatedAt.toDate();
                else if (typeof lead.updatedAt === 'string') lastActionDate = new Date(lead.updatedAt);
            } else if (lead.createdAt) {
                if (lead.createdAt instanceof Timestamp) lastActionDate = lead.createdAt.toDate();
                else if (typeof lead.createdAt === 'string') lastActionDate = new Date(lead.createdAt);
            }

            if (status === 'new') {
                if (!lastActionDate || isBefore(lastActionDate, sevenDaysAgo)) {
                    unattended.push(lead);
                }
            }
        });

        const totalAssigned = leads.length;
        const avgAttempts = totalAssigned > 0 ? (totalCalls / totalAssigned).toFixed(1) : "0";
        const conversion = totalAssigned > 0 ? ((convertedCount / totalAssigned) * 100).toFixed(1) : "0";

        // Format Chart Data
        const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
        
        const dailyData = [];
        for (let i = 6; i >= 0; i--) {
            const d = subDays(new Date(), i);
            const key = format(d, 'MMM dd');
            dailyData.push({
                date: key,
                calls: activityMap[key] || 0
            });
        }

        setMetrics({
            totalAssigned,
            contacted: contactedCount,
            avgAttempts: Number(avgAttempts),
            conversion: Number(conversion),
            statusDistribution: statusData,
            dailyActivity: dailyData
        });

        setUnattendedLeads(unattended);
        setConvertedLeads(converted);
        setLoading(false);
    };

    // Query 1: Assigned To
    const q1 = query(leadsRef, where('assignedTo', '==', employeeId));
    const unsub1 = onSnapshot(q1, (snapshot) => {
        assignedDocs = snapshot.docs.map(d => ({ ...d.data(), leadId: d.id } as LeadDoc));
        loadedAssigned = true;
        processLeads();
    });

    // Query 2: Closed By
    const q2 = query(leadsRef, where('closedBy.uid', '==', employeeId));
    const unsub2 = onSnapshot(q2, (snapshot) => {
        closedDocs = snapshot.docs.map(d => ({ ...d.data(), leadId: d.id } as LeadDoc));
        loadedClosed = true;
        processLeads();
    });

    return () => {
        unsub1();
        unsub2();
    };
  }, [employeeId]);

  // 4. Shuffle Logic
  const handleSelectAll = () => {
    if (selectedLeads.size === unattendedLeads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(unattendedLeads.map(l => l.leadId)));
    }
  };

  const handleToggleLead = (id: string) => {
    const next = new Set(selectedLeads);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedLeads(next);
  };

  const handleShuffleLeads = async () => {
    if (!targetAgent || selectedLeads.size === 0 || !db) return;
    setProcessing(true);

    try {
      const batch = writeBatch(db);
      
      selectedLeads.forEach(leadId => {
        if (!db) return;
        const leadRef = doc(db, 'leads', leadId);
        batch.update(leadRef, {
          assignedTo: targetAgent,
          assignedBy: 'system_shuffle', // Or current user ID
          status: 'new', // Reset status for new agent
          assignedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          history: [{ // Add audit log
            action: 'shuffled',
            oldStatus: 'new',
            newStatus: 'new',
            remarks: `Re-assigned from ${employee?.name || 'previous agent'} to new agent due to inactivity`,
            updatedBy: 'system',
            timestamp: new Date().toISOString() // using ISO string for consistency with type definition
          }]
        });
      });

      await batch.commit();
      
      // Reset UI
      setSelectedLeads(new Set());
      setTargetAgent('');
      setIsShuffleModalOpen(false);
      // Ideally show a toast here
      alert(`Successfully shuffled ${selectedLeads.size} leads.`);
    } catch (error) {
      console.error("Shuffle failed:", error);
      alert("Failed to shuffle leads. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  // Helper for Status Colors 
  const getStatusColor = (status: string) => { 
    switch(status?.toLowerCase()) { 
      case 'interested': return 'bg-green-100 text-green-800'; 
      case 'dead': return 'bg-red-100 text-red-800'; 
      case 'new': return 'bg-blue-100 text-blue-800'; 
      case 'hot': return 'bg-rose-100 text-rose-800';
      case 'warm': return 'bg-amber-100 text-amber-800';
      case 'followup': return 'bg-violet-100 text-violet-800';
      case 'closed': return 'bg-emerald-100 text-emerald-800';
      case 'cold': return 'bg-slate-100 text-slate-800';
      default: return 'bg-gray-100 text-gray-800'; 
    } 
  };

  const getLatestRemark = (lead: LeadDoc) => {
    // Check if remarks field is a string and non-empty
    if (lead.remarks && lead.remarks.trim().length > 0) {
       return lead.remarks;
    }

    // Check activityHistory for latest note (preferred over legacy history)
    if (lead.activityHistory && lead.activityHistory.length > 0) {
        const sorted = [...lead.activityHistory].sort((a, b) => {
            const getTime = (val: unknown) => {
                if (val instanceof Timestamp) return val.toMillis();
                if (typeof val === 'string' || typeof val === 'number') return new Date(val).getTime();
                return 0;
            };
            const tA = getTime(a.at);
            const tB = getTime(b.at);
            return tB - tA;
        });
        const entry = sorted.find(h => h.note);
        if (entry) return entry.note;
    }

    // Check history array for latest remark (legacy/audit)
    if (lead.history && lead.history.length > 0) {
       // Sort by timestamp desc to be safe, though usually appended
       const sorted = [...lead.history].sort((a, b) => {
          const getTime = (val: unknown) => {
            if (val instanceof Timestamp) return val.toMillis();
            if (typeof val === 'string' || typeof val === 'number') return new Date(val).getTime();
            return 0;
          };
          const tA = getTime(a.timestamp);
          const tB = getTime(b.timestamp);
          return tB - tA;
       });
       // Find first entry with remarks
       const entry = sorted.find(h => h.remarks);
       if (entry) return entry.remarks;
    }
    return null;
  };

  const getLastUpdated = (lead: LeadDoc) => {
    let date: Date | null = null;
    if (lead.lastActionAt) {
       if (lead.lastActionAt instanceof Timestamp) date = lead.lastActionAt.toDate();
       else if (typeof lead.lastActionAt === 'string') date = new Date(lead.lastActionAt);
    } else if (lead.updatedAt) {
       if (lead.updatedAt instanceof Timestamp) date = lead.updatedAt.toDate();
       else if (typeof lead.updatedAt === 'string') date = new Date(lead.updatedAt);
    } else if (lead.createdAt) {
       if (lead.createdAt instanceof Timestamp) date = lead.createdAt.toDate();
       else if (typeof lead.createdAt === 'string') date = new Date(lead.createdAt);
    }

    if (!date) return '—';
    return (
      <>
        {date.toLocaleDateString()} <br/> 
        <span className="text-xs text-gray-400">{date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
      </>
    );
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">Loading performance data...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50/50 p-6 md:p-8 space-y-8 font-sans">
      
      {/* HEADER CARD - PORTFOLIO STYLE */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 flex flex-col md:flex-row md:items-center gap-6"> 
         <div className="h-20 w-20 rounded-full bg-indigo-100 flex items-center justify-center text-2xl font-bold text-indigo-600 border-4 border-white shadow-sm"> 
            {/* Avatar / Initials */} 
            {(employee?.name || employee?.displayName || 'E').charAt(0)} 
         </div> 
         <div className="flex-1"> 
           <h2 className="text-2xl font-bold text-gray-900">{employee?.name || employee?.displayName || 'Employee'}</h2> 
           <p className="text-gray-500">{employee?.role ? employee.role.toUpperCase() : 'AGENT'} • {employee?.email}</p> 
           <div className="mt-3 flex flex-wrap gap-3 text-sm"> 
              <span className="px-3 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-600 font-mono text-xs flex items-center">
                ID: {employee?.employeeId || employee?.uid?.slice(0,6) || '—'}
              </span> 
              <span className="px-3 py-1 rounded-full bg-green-50 text-green-700 border border-green-100 flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                Active
              </span> 
              <span className="px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center gap-1">
                <UserGroupIcon className="w-3 h-3" />
                {metrics?.totalAssigned || 0} Leads
              </span>
           </div> 
         </div>
         
         <div className="flex flex-col md:flex-row items-center gap-4 self-start md:self-center">
           <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-xl border border-gray-200 shadow-sm">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider px-2">Data Scope</span>
              <select className="text-sm font-semibold text-gray-700 bg-transparent border-none focus:ring-0 cursor-pointer">
                <option>Last 30 Days</option>
                <option>This Month</option>
                <option>All Time</option>
              </select>
           </div>
           <DownloadReportButton 
             employeeId={employeeId} 
             month={new Date()} 
           />
         </div>
      </div>

      {/* METRICS GRID (Bento Style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-6">
        <MetricCard 
          title="Leads Contacted" 
          value={metrics?.contacted} 
          subtext={`${metrics?.totalAssigned} assigned`}
          icon={<PhoneIcon className="w-5 h-5 text-indigo-500" />}
          trend={metrics?.contacted && metrics?.totalAssigned ? `${Math.round((metrics.contacted / metrics.totalAssigned) * 100)}% coverage` : "0%"}
        />
        <MetricCard 
          title="Avg. Attempts/Lead" 
          value={metrics?.avgAttempts} 
          subtext="Effort Intensity"
          icon={<ArrowPathIcon className="w-5 h-5 text-blue-500" />} 
          trend="Target: > 3.0"
        />
        <MetricCard 
          title="Conversion Rate" 
          value={`${metrics?.conversion}%`} 
          subtext="Closed / Assigned"
          icon={<CheckCircleIcon className="w-5 h-5 text-emerald-500" />}
          color="text-emerald-600"
          trend="vs 12% team avg"
        />
        <div onClick={() => setIsSalesModalOpen(true)} className="cursor-pointer transition-transform hover:scale-105 active:scale-95">
            <MetricCard 
            title="Total Sales" 
            value={convertedLeads.length} 
            subtext="Click for details"
            icon={<BanknotesIcon className="w-5 h-5 text-emerald-600" />}
            color="text-emerald-700"
            trend="View List →"
            />
        </div>
        <MetricCard
          title="Linked Tasks"
          value={taskLinkHealth.linked}
          subtext="Tasks with a live CRM record"
          icon={<UserGroupIcon className="w-5 h-5 text-indigo-500" />}
          trend="Week 13 integrity"
        />
        <MetricCard
          title="Task Link Issues"
          value={taskLinkHealth.orphaned + taskLinkHealth.ownerMismatch}
          subtext={`${taskLinkHealth.orphaned} missing lead, ${taskLinkHealth.ownerMismatch} owner drift`}
          icon={<ExclamationCircleIcon className="w-5 h-5 text-amber-500" />}
          color="text-amber-700"
          trend="Fix from Tasks"
        />
      </div>

      {/* CHARTS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Activity Over Time (Bar Chart) */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 lg:col-span-2 flex flex-col">
           <div className="mb-6">
              <h3 className="text-lg font-bold text-gray-900">Activity Volume</h3>
              <p className="text-sm text-gray-500">Daily calls and interactions over the last 7 days</p>
           </div>
           <div className="flex-1 min-h-[300px]">
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={metrics?.dailyActivity}>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                 <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#9CA3AF', fontSize: 12}} 
                    dy={10}
                 />
                 <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#9CA3AF', fontSize: 12}} 
                 />
                 <Tooltip 
                    cursor={{fill: '#F9FAFB'}}
                    contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                 />
                 <Bar dataKey="calls" fill="#6366F1" radius={[6, 6, 0, 0]} barSize={40} />
               </BarChart>
             </ResponsiveContainer>
           </div>
        </div>

        {/* Status Distribution (Pie Chart) */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 lg:col-span-1 flex flex-col">
           <div className="mb-6">
              <h3 className="text-lg font-bold text-gray-900">Lead Outcomes</h3>
              <p className="text-sm text-gray-500">Current status distribution</p>
           </div>
           <div className="flex-1 min-h-[300px] relative">
             <ResponsiveContainer width="100%" height="100%">
               <PieChart>
                 <Pie
                   data={metrics?.statusDistribution}
                   cx="50%"
                   cy="50%"
                   innerRadius={60}
                   outerRadius={80}
                   paddingAngle={5}
                   dataKey="value"
                 >
                   {metrics?.statusDistribution.map((entry, index) => (
                     <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.name.toLowerCase()] || COLORS[index % COLORS.length]} />
                   ))}
                 </Pie>
                 <Tooltip contentStyle={{borderRadius: '12px'}} />
                 <Legend verticalAlign="bottom" height={36} iconType="circle" />
               </PieChart>
             </ResponsiveContainer>
             {/* Center Text */}
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                   <span className="block text-2xl font-bold text-gray-900">{metrics?.totalAssigned}</span>
                   <span className="text-xs text-gray-500 uppercase">Total</span>
                </div>
             </div>
           </div>
        </div>
      </div>

      {/* ATTENDANCE SECTION */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col">
          <div className="mb-6 flex items-center justify-between">
             <div>
                <h3 className="text-lg font-bold text-gray-900">Attendance Record</h3>
                <p className="text-sm text-gray-500">Monthly attendance status and trends</p>
             </div>
             <button 
                onClick={() => setIsAttendanceModalOpen(true)}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
             >
                View Calendar →
             </button>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div 
                onClick={() => setIsAttendanceModalOpen(true)}
                className="cursor-pointer group p-4 rounded-2xl bg-emerald-50 border border-emerald-100 hover:shadow-md transition-all"
              >
                 <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600 group-hover:scale-110 transition-transform">
                       <CheckCircleIcon className="w-5 h-5" />
                    </div>
                    <span className="text-sm font-medium text-emerald-900">Present</span>
                 </div>
                 <div className="text-2xl font-bold text-emerald-700">{attendanceStats.present} <span className="text-xs font-normal opacity-70">days</span></div>
              </div>

              <div 
                onClick={() => setIsAttendanceModalOpen(true)}
                className="cursor-pointer group p-4 rounded-2xl bg-amber-50 border border-amber-100 hover:shadow-md transition-all"
              >
                 <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-amber-100 rounded-lg text-amber-600 group-hover:scale-110 transition-transform">
                       <ClockIcon className="w-5 h-5" />
                    </div>
                    <span className="text-sm font-medium text-amber-900">On Leave</span>
                 </div>
                 <div className="text-2xl font-bold text-amber-700">{attendanceStats.leave} <span className="text-xs font-normal opacity-70">days</span></div>
              </div>

              <div 
                onClick={() => setIsAttendanceModalOpen(true)}
                className="cursor-pointer group p-4 rounded-2xl bg-rose-50 border border-rose-100 hover:shadow-md transition-all"
              >
                 <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-rose-100 rounded-lg text-rose-600 group-hover:scale-110 transition-transform">
                       <ExclamationCircleIcon className="w-5 h-5" />
                    </div>
                    <span className="text-sm font-medium text-rose-900">Absent</span>
                 </div>
                 <div className="text-2xl font-bold text-rose-700">{attendanceStats.absent} <span className="text-xs font-normal opacity-70">days</span></div>
              </div>

              <div 
                onClick={() => setIsAttendanceModalOpen(true)}
                className="cursor-pointer group p-4 rounded-2xl bg-indigo-50 border border-indigo-100 hover:shadow-md transition-all"
              >
                 <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600 group-hover:scale-110 transition-transform">
                       <CalendarDaysIcon className="w-5 h-5" />
                    </div>
                    <span className="text-sm font-medium text-indigo-900">Holidays</span>
                 </div>
                 <div className="text-2xl font-bold text-indigo-700">{attendanceStats.holidays} <span className="text-xs font-normal opacity-70">days</span></div>
              </div>
          </div>

          <AttendanceCalendarModal
              isOpen={isAttendanceModalOpen}
              onClose={() => setIsAttendanceModalOpen(false)}
              uid={employeeId}
              userName={employee?.name || ''}
          />
      </div>

      {/* 2. LEAD PORTFOLIO TABLE (Status & Remarks) */} 
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden"> 
         <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between"> 
           <div className="flex items-center gap-4">
             <h3 className="text-lg font-bold text-gray-900">Assigned Portfolio & Remarks</h3>
             <span className="text-xs font-medium bg-gray-100 text-gray-500 px-2 py-1 rounded-full">{filteredLeads.length} / {allLeads.length}</span>
           </div>
           
           <div className="flex items-center gap-2">
              <label htmlFor="status-filter" className="text-sm font-medium text-gray-700">Filter Status:</label>
              <select 
                id="status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-sm border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 py-1.5 pl-3 pr-8"
              >
                <option value="all">All Statuses</option>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="interested">Interested</option>
                <option value="followup">Follow Up</option>
                <option value="hot">Hot</option>
                <option value="warm">Warm</option>
                <option value="cold">Cold</option>
                <option value="closed">Closed</option>
                <option value="dead">Dead</option>
              </select>
           </div>
         </div> 
         
         <div className="overflow-x-auto"> 
           <table className="min-w-full divide-y divide-gray-200"> 
             <thead className="bg-gray-50/50"> 
               <tr> 
                 <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Lead Name</th> 
                 <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Current Status</th> 
                 <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-1/3">Latest Remark</th> 
                 <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Updated</th> 
               </tr> 
             </thead> 
             <tbody className="bg-white divide-y divide-gray-200"> 
               {filteredLeads.length === 0 ? (
                 <tr>
                    <td colSpan={4} className="p-8 text-center text-gray-400 italic">
                       {statusFilter === 'all' ? 'No leads assigned yet.' : 'No leads match the selected filter.'}
                    </td>
                 </tr>
               ) : (
                 filteredLeads.map((lead) => ( 
                   <tr key={lead.leadId} className="hover:bg-gray-50/80 transition-colors"> 
                     
                     {/* Lead Info */} 
                     <td className="px-6 py-4 whitespace-nowrap"> 
                       <div className="text-sm font-semibold text-gray-900">{lead.name}</div> 
                       <div className="text-xs text-gray-500 font-mono mt-0.5">{lead.phone || 'No phone'}</div> 
                     </td> 
   
                     {/* Status Badge */} 
                     <td className="px-6 py-4 whitespace-nowrap"> 
                       <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full capitalize shadow-sm ${getStatusColor(lead.status)}`}> 
                         {lead.status} 
                       </span> 
                     </td> 
   
                     {/* Remarks (The Critical Audit Field) */} 
                     <td className="px-6 py-4"> 
                       <div className="group relative">
                         <div className="text-sm text-gray-700 line-clamp-2 max-w-xs cursor-help"> 
                           {getLatestRemark(lead) || <span className="text-gray-300 italic text-xs">No remarks entered...</span>} 
                         </div>
                         {/* Tooltip on hover if long text - handled by browser title or custom */}
                         {getLatestRemark(lead) && (
                            <div className="absolute left-0 bottom-full mb-2 hidden w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg group-hover:block z-10">
                               {getLatestRemark(lead)}
                            </div>
                         )}
                       </div> 
                     </td> 
   
                     {/* Timestamp */} 
                     <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500"> 
                       {getLastUpdated(lead)}
                     </td> 
   
                   </tr> 
                 ))
               )} 
             </tbody> 
           </table>
         </div>
         {/* Pagination or load more could go here */}
      </div>

      {/* ACTION ZONE: Unattended Leads Redistribution */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-50 flex flex-col md:flex-row justify-between md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
               <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse"></div>
               <h3 className="text-lg font-bold text-gray-900">Unattended Leads ({unattendedLeads.length})</h3>
            </div>
            <p className="text-sm text-gray-500 mt-1">Stagnant leads (Status: &apos;New&apos; & No activity for 7+ days). <span className="text-indigo-600 font-medium cursor-pointer hover:underline">View Policy</span></p>
          </div>
          
          {/* SHUFFLE CONTROLS */}
          {unattendedLeads.length > 0 && (
            <div className="flex gap-3 items-center">
               <span className="text-sm text-gray-500 font-medium">
                  {selectedLeads.size} selected
               </span>
               <button 
                 onClick={() => setIsShuffleModalOpen(true)}
                 disabled={selectedLeads.size === 0}
                 className={`
                    px-5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2
                    ${selectedLeads.size > 0 
                      ? 'bg-gray-900 text-white hover:bg-gray-800 shadow-lg shadow-gray-200' 
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'}
                 `}
               >
                 <UserGroupIcon className="w-4 h-4" />
                 Shuffle / Re-assign
               </button>
            </div>
          )}
        </div>

        {/* TABLE OF STAGNANT LEADS */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-50 bg-gray-50/50 text-xs uppercase tracking-wide text-gray-500">
                <th className="p-4 w-12">
                  <input 
                    type="checkbox" 
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    checked={unattendedLeads.length > 0 && selectedLeads.size === unattendedLeads.length}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="p-4 font-semibold">Lead Name</th>
                <th className="p-4 font-semibold">Contact</th>
                <th className="p-4 font-semibold">Assigned Date</th>
                <th className="p-4 font-semibold">Wait Time</th>
                <th className="p-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-sm">
              {unattendedLeads.length === 0 ? (
                 <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-400 italic">
                       No unattended leads found. Great job! 🎉
                    </td>
                 </tr>
              ) : (
                unattendedLeads.map((lead) => {
                  // Calculate wait time
                  const assignedDate = lead.assignedAt 
                     ? (lead.assignedAt instanceof Timestamp ? lead.assignedAt.toDate() : new Date(lead.assignedAt as string))
                     : (lead.createdAt instanceof Timestamp ? lead.createdAt.toDate() : new Date(lead.createdAt as string));
                  
                  const daysWaiting = Math.floor((new Date().getTime() - assignedDate.getTime()) / (1000 * 3600 * 24));

                  return (
                    <tr key={lead.leadId} className={`hover:bg-gray-50/80 transition-colors ${selectedLeads.has(lead.leadId) ? 'bg-indigo-50/30' : ''}`}>
                      <td className="p-4">
                        <input 
                          type="checkbox" 
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          checked={selectedLeads.has(lead.leadId)}
                          onChange={() => handleToggleLead(lead.leadId)}
                        />
                      </td>
                      <td className="p-4">
                        <div className="font-semibold text-gray-900">{lead.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{lead.leadId}</div>
                      </td>
                      <td className="p-4 text-gray-600">
                        <div className="flex flex-col">
                           <span>{lead.phone || '—'}</span>
                           <span className="text-xs text-gray-400">{lead.email || ''}</span>
                        </div>
                      </td>
                      <td className="p-4 text-gray-600">
                        {format(assignedDate, 'MMM dd, yyyy')}
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          <ClockIcon className="w-3 h-3" />
                          {daysWaiting} days
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-600 uppercase tracking-wide">
                          {lead.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SHUFFLE MODAL */}
      <Transition show={isShuffleModalOpen} as={Fragment}>
        <Dialog onClose={() => setIsShuffleModalOpen(false)} className="relative z-50">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
          </TransitionChild>

          <div className="fixed inset-0 flex items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl transition-all p-6">
                <DialogTitle className="text-lg font-bold text-gray-900 mb-2">
                  Re-assign Leads
                </DialogTitle>
                <p className="text-sm text-gray-500 mb-6">
                  You are about to move <strong className="text-gray-900">{selectedLeads.size}</strong> leads from {employee?.name} to another agent.
                </p>

                <div className="space-y-4">
                   <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Select New Owner</label>
                      <select 
                        className="w-full rounded-xl border-gray-200 text-sm focus:ring-indigo-500 focus:border-indigo-500 p-3 bg-gray-50"
                        value={targetAgent}
                        onChange={(e) => setTargetAgent(e.target.value)}
                      >
                        <option value="">Choose an agent...</option>
                        {subordinates.map(sub => (
                           <option key={sub.uid} value={sub.uid}>{sub.name} ({sub.role})</option>
                        ))}
                      </select>
                   </div>
                </div>

                <div className="mt-8 flex justify-end gap-3">
                  <button 
                    onClick={() => setIsShuffleModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleShuffleLeads}
                    disabled={!targetAgent || processing}
                    className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-lg shadow-indigo-200 transition-all disabled:opacity-50 disabled:shadow-none"
                  >
                    {processing ? 'Processing...' : 'Confirm Transfer'}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>

      {/* SALES DETAILS MODAL */}
      <Transition show={isSalesModalOpen} as={Fragment}>
        <Dialog onClose={() => setIsSalesModalOpen(false)} className="relative z-50">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
          </TransitionChild>

          <div className="fixed inset-0 flex items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-4xl max-h-[80vh] overflow-hidden rounded-2xl bg-white shadow-xl transition-all flex flex-col">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <DialogTitle className="text-xl font-bold text-gray-900">
                        Sales Details
                        </DialogTitle>
                        <p className="text-sm text-gray-500">List of converted leads/sales by {employee?.name}</p>
                    </div>
                    <button 
                        onClick={() => setIsSalesModalOpen(false)}
                        className="rounded-full p-1 hover:bg-gray-100 text-gray-500"
                    >
                        <span className="sr-only">Close</span>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-0">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Lead / Student</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">University / Course</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fees</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">UTR Details</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Closed Date</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {convertedLeads.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500 italic">
                                        No sales records found.
                                    </td>
                                </tr>
                            ) : (
                                convertedLeads.map((lead) => {
                                    const closedDate = lead.enrollmentDetails?.closedAt || lead.closedAt || lead.updatedAt;
                                    const formattedDate = closedDate 
                                        ? (closedDate instanceof Timestamp ? closedDate.toDate() : new Date(closedDate as string)).toLocaleDateString()
                                        : '—';

                                    return (
                                        <tr key={lead.leadId} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm font-semibold text-gray-900">{lead.name}</div>
                                                <div className="text-xs text-gray-500">{lead.phone || '—'}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900">{lead.enrollmentDetails?.university || '—'}</div>
                                                <div className="text-xs text-gray-500">{lead.enrollmentDetails?.course || '—'}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm font-mono text-gray-900">
                                                    {lead.enrollmentDetails?.fee ? `₹${lead.enrollmentDetails.fee.toLocaleString()}` : '—'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900">{lead.enrollmentDetails?.utrNumber || lead.enrollmentDetails?.emiDetails || '—'}</div>
                                                {lead.enrollmentDetails?.paymentMode && <div className="text-xs text-gray-500">{lead.enrollmentDetails.paymentMode}</div>}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {formattedDate}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${getStatusColor(lead.status)}`}>
                                                    {isPaymentFollowUpStatus(lead.status) ? 'Payment Pending' : lead.status}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                
                <div className="p-4 border-t border-gray-100 bg-gray-50 text-right">
                     <span className="text-xs text-gray-500">Total Sales: {convertedLeads.length}</span>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>

    </div>
  );
}

// Sub-components
interface MetricCardProps {
  title: string;
  value?: string | number | null;
  subtext?: string;
  icon?: React.ReactNode;
  trend?: string;
  color?: string;
}

function MetricCard({ title, value, subtext, icon, trend, color }: MetricCardProps) {
  return (
    <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between h-full">
      <div className="flex justify-between items-start mb-4">
        <div className={`p-3 rounded-2xl ${color ? 'bg-green-50' : 'bg-gray-50'}`}>
          {icon}
        </div>
        {trend && (
           <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-50 text-green-700">
             {trend}
           </span>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium text-gray-500 mb-1">{title}</h3>
        <div className={`text-3xl font-bold tracking-tight ${color ? color : 'text-gray-900'}`}>
          {value !== undefined ? value : "—"}
        </div>
        {subtext && <p className="text-xs text-gray-400 mt-2">{subtext}</p>}
      </div>
    </div>
  );
}
