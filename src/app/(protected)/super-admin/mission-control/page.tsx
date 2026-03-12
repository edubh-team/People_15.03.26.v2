"use client";

import { useState, Fragment } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { motion, AnimatePresence } from "framer-motion";
import { ResponsiveContainer, Cell, Funnel, FunnelChart, Tooltip } from "recharts";
import { formatDistanceToNow } from "date-fns";
import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import LeadDetailPanel from "@/components/leads/LeadDetailPanel";
import { LeadDoc } from "@/lib/types/crm";
import { 
  UserGroupIcon, 
  CurrencyRupeeIcon, 
  PresentationChartLineIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  BoltIcon,
  ChartBarIcon,
  SignalIcon,
  AcademicCapIcon,
  BanknotesIcon,
  ClockIcon,
  UserIcon,
  ArrowPathIcon,
  SparklesIcon,
  ClipboardDocumentCheckIcon
} from "@heroicons/react/24/outline";
import { useMissionControlData, type OrgNode, type ActivityDoc } from "@/lib/hooks/useMissionControlData";
import { cn } from "@/lib/cn";

import LeadInspector from "@/components/super-admin/LeadInspector";

import { RoleBadge } from "@/components/RoleBadge";

const COLORS = ["#6366F1", "#818CF8", "#A855F7", "#10B981"]; // Indigo -> Indigo-Light -> Purple -> Emerald

function Bento({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80 hover:-translate-y-1 ${className}`}>
      {children}
    </div>
  );
}

// Local LeadInspector removed in favor of imported component

function TreeNode({ node, depth = 0 }: { node: OrgNode; depth?: number }) {
  const [isOpen, setIsOpen] = useState(depth < 2); // Auto-expand top levels
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="relative">
      <div 
        className={`flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer border border-transparent hover:border-slate-100 ${depth > 0 ? "ml-6" : ""}`}
        onClick={() => hasChildren && setIsOpen(!isOpen)}
      >
        {/* Connector Line for children */}
        {depth > 0 && (
          <div className="absolute left-[-12px] top-1/2 w-3 h-px bg-slate-200" />
        )}
        
        <div className="flex-shrink-0 w-4 text-slate-400">
           {hasChildren ? (
             isOpen ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />
           ) : <div className="w-4 h-4" />}
        </div>

        {/* Avatar Placeholder */}
        <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 ring-2 ring-white">
          {(node.displayName || node.email || "?")[0].toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-900 truncate">{node.displayName || node.email}</div>
          <div className="flex items-center gap-2">
            <RoleBadge role={node.role || node.orgRole || "Employee"} />
            {node.directReportsCount > 0 && (
               <span className="text-[10px] text-slate-400">{node.directReportsCount} reports</span>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="relative border-l border-slate-200 ml-4" // Vertical line
          >
            {node.children.map((child) => (
              <TreeNode key={child.uid} node={child} depth={depth + 1} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HierarchyTree({ data }: { data: OrgNode[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">
        No organization data found.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
       <div className="flex items-center gap-2 mb-4">
        <UserGroupIcon className="h-5 w-5 text-emerald-500" />
        <span className="text-sm font-semibold tracking-tight text-slate-900">Organization Tree</span>
      </div>
      <div className="flex-1 overflow-auto pr-2">
        {data.map(node => <TreeNode key={node.uid} node={node} />)}
      </div>
    </div>
  );
}

function KPICard({ title, value, subtext, icon: Icon, colorClass = "text-indigo-600" }: { title: string; value: string | number; subtext: string; icon: React.ElementType; colorClass?: string }) {
  return (
    <Bento>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-5 w-5 ${colorClass}`} />
        <span className="text-sm font-semibold tracking-tight text-slate-900">{title}</span>
      </div>
      <div className="mt-2">
         <motion.div 
           key={String(value)} 
           initial={{ scale: 0.95, opacity: 0.5 }} 
           animate={{ scale: 1, opacity: 1 }}
           className="text-3xl font-bold tabular-nums text-slate-900"
         >
           {value}
         </motion.div>
         <div className="text-xs text-slate-500 mt-1">{subtext}</div>
      </div>
    </Bento>
  );
}

function ActivityFeed({ feed }: { feed: ActivityDoc[] }) {
  if (!feed || feed.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400">
        <div className="rounded-full bg-slate-100 p-3 mb-2">
           <BoltIcon className="w-6 h-6 text-slate-400" />
        </div>
        <p className="text-sm">System Quiet</p>
        <p className="text-xs">No recent activity detected.</p>
      </div>
    );
  }

  const getIconConfig = (type: string) => {
    switch (type) {
      case 'sale': 
        return { Icon: BanknotesIcon, color: 'text-emerald-600', bg: 'bg-emerald-100', ring: 'ring-emerald-500/20' };
      case 'attendance': 
        return { Icon: ClockIcon, color: 'text-blue-600', bg: 'bg-blue-100', ring: 'ring-blue-500/20' };
      case 'login': 
        return { Icon: UserIcon, color: 'text-indigo-600', bg: 'bg-indigo-100', ring: 'ring-indigo-500/20' };
      case 'new_lead': 
        return { Icon: SparklesIcon, color: 'text-purple-600', bg: 'bg-purple-100', ring: 'ring-purple-500/20' };
      case 'system_audit': 
        return { Icon: ClipboardDocumentCheckIcon, color: 'text-gray-600', bg: 'bg-gray-100', ring: 'ring-gray-500/20' };
      case 'status_change': 
        return { Icon: ArrowPathIcon, color: 'text-amber-600', bg: 'bg-amber-100', ring: 'ring-amber-500/20' };
      default: 
        return { Icon: BoltIcon, color: 'text-slate-600', bg: 'bg-slate-100', ring: 'ring-slate-500/20' };
    }
  };

  return (
    <div className="h-full flex flex-col">
       <div className="flex items-center gap-2 mb-4 sticky top-0 bg-white/60 backdrop-blur-sm z-10 py-2 border-b border-slate-100/50">
        <BoltIcon className="h-5 w-5 text-amber-500" />
        <span className="text-sm font-semibold tracking-tight text-slate-900">Live Activity Feed</span>
      </div>
      <div className="flex-1 overflow-auto pr-2 space-y-4 scrollbar-thin scrollbar-thumb-slate-200">
        <AnimatePresence initial={false}>
          {feed.map((item) => {
            const { Icon, color, bg, ring } = getIconConfig(item.type);
            return (
              <motion.div 
                key={item.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className="flex gap-3 items-start group"
              >
                <div className={`h-8 w-8 rounded-full ${bg} flex-shrink-0 flex items-center justify-center ring-1 ${ring}`}>
                   <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                   <p className="text-sm text-slate-900 leading-tight">
                     <span className="font-medium">{item.user?.displayName || "Unknown User"}</span>{" "}
                     <span className="text-slate-600">{item.description || `performed ${item.type}`}</span>
                   </p>
                   <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                     <ClockIcon className="w-3 h-3" />
                     {item.timestamp ? formatDistanceToNow(item.timestamp, { addSuffix: true }) : "Just now"}
                   </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function UniversityLeadsModal({ 
  isOpen, 
  onClose, 
  universityName, 
  leads 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  universityName: string; 
  leads: LeadDoc[]; 
}) {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
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

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-4xl transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-lg font-medium leading-6 text-slate-900">
                      {universityName}
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Enrolled Students List ({leads.length})
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="rounded-full p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <span className="sr-only">Close</span>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Student Details</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Course Info</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Fees & UTR</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Closed By</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                      {leads.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                            No enrolled students found.
                          </td>
                        </tr>
                      ) : (
                        leads.map((lead) => (
                          <tr key={lead.leadId} className="hover:bg-slate-50/50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-slate-900">{lead.name}</div>
                              <div className="text-xs text-slate-500">{lead.phone || "No phone"}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-slate-900">{lead.enrollmentDetails?.course || lead.targetDegree || "—"}</div>
                              <div className="text-xs text-slate-500">{lead.enrollmentDetails?.university || lead.targetUniversity || "—"}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-semibold text-slate-900">
                                ₹{Intl.NumberFormat('en-IN').format(Number(lead.enrollmentDetails?.fee || lead.courseFees || 0))}
                              </div>
                              <div className="text-xs text-slate-500 font-mono mt-0.5">
                                UTR: {lead.enrollmentDetails?.utrNumber || lead.enrollmentDetails?.emiDetails || "—"}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-slate-900">
                                {lead.closedBy?.name || "—"}
                              </div>
                              <div className="text-xs text-slate-500">
                                {lead.ownerUid ? "Owner" : "Assignee"}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

function UniversityRevenueCard({ 
  breakdown,
  onUniversityClick
}: { 
  breakdown: { name: string; revenue: number; salesValue: number; count: number; leads: LeadDoc[] }[];
  onUniversityClick: (uni: { name: string; revenue: number; salesValue: number; count: number; leads: LeadDoc[] }) => void;
}) {
  if (!breakdown || breakdown.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400">
        <div className="rounded-full bg-slate-100 p-3 mb-2">
           <AcademicCapIcon className="w-6 h-6 text-slate-400" />
        </div>
        <p className="text-sm">No University Data</p>
        <p className="text-xs">No enrolled students found.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
       <div className="flex items-center gap-2 mb-4 sticky top-0 bg-white/60 backdrop-blur-sm z-10 py-2 border-b border-slate-100/50">
        <AcademicCapIcon className="h-5 w-5 text-indigo-500" />
        <span className="text-sm font-semibold tracking-tight text-slate-900">University Revenue Breakdown</span>
      </div>
      <div className="flex-1 overflow-auto pr-2 space-y-3 scrollbar-thin scrollbar-thumb-slate-200">
        {breakdown.map((uni, idx) => (
          <div 
            key={idx} 
            onClick={() => onUniversityClick(uni)}
            className="group relative overflow-hidden rounded-xl bg-slate-50 p-3 transition-all hover:bg-indigo-50/50 border border-slate-100 hover:border-indigo-100 cursor-pointer"
          >
             <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                   <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200 text-indigo-600 font-bold text-xs">
                      {uni.name.charAt(0).toUpperCase()}
                   </div>
                   <div>
                      <div className="text-sm font-medium text-slate-900">{uni.name}</div>
                      <div className="text-xs text-slate-500">{uni.count} Enrolled Students</div>
                   </div>
                </div>
                <div className="text-right">
                   <div className="text-sm font-bold text-slate-900">
                      ₹{Intl.NumberFormat('en-IN', { notation: "compact", maximumFractionDigits: 1 }).format(uni.revenue)}
                   </div>
                   <div className="text-[10px] uppercase tracking-wide text-indigo-600 font-semibold">Revenue</div>
                </div>
             </div>
             
             {/* Sales Value Details */}
             <div className="mt-2 flex items-center justify-between border-t border-slate-200/60 pt-2">
                <span className="text-xs text-slate-500">Total Sales Volume</span>
                <span className="text-xs font-medium text-slate-700">
                  ₹{Intl.NumberFormat('en-IN').format(uni.salesValue)}
                </span>
             </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MissionControlSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex justify-between items-center">
          <div className="space-y-2">
             <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
             <div className="h-8 w-64 bg-slate-200 rounded animate-pulse" />
          </div>
          <div className="h-8 w-32 bg-slate-200 rounded-full animate-pulse" />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 auto-rows-[180px]">
          {[...Array(8)].map((_, i) => {
             // Determine classes based on index to match real layout
             let classes = "rounded-[24px] bg-white/60 p-6 border border-white/20 shadow-sm";
             
             // Width: Revenue (0), Hierarchy (3), University (6), Activity (7) are wide
             if ([0, 3, 6, 7].includes(i)) classes += " md:col-span-2";
             
             // Height: All except top row (0,1,2) are tall
             if (i >= 3) classes += " row-span-2";
             
             return (
               <div key={i} className={classes}>
                 <div className="h-full w-full bg-slate-100 rounded-xl animate-pulse" />
               </div>
             );
          })}
        </div>
      </div>
    </div>
  );
}

export default function MissionControlPage() {
  const { userDoc } = useAuth();
  const { treeData, pipelineStats, activityFeed, loading, error } = useMissionControlData();
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadDoc | null>(null);
  const [revenueTimeRange, setRevenueTimeRange] = useState<'today' | 'weekly' | 'monthly' | 'total'>('total');
  
  // University Modal State
  const [isUniversityModalOpen, setIsUniversityModalOpen] = useState(false);
  const [selectedUniversity, setSelectedUniversity] = useState<{ name: string; revenue: number; salesValue: number; count: number; leads: LeadDoc[] } | null>(null);

  // Safe access to pipeline stats
  const totalRevenue = pipelineStats?.pipelineValue || 0;
  const totalEnrolledFees = pipelineStats?.totalEnrolledValue || 0;
  const totalEnrolledCount = pipelineStats?.totalEnrolledCount || 0;
  
  const currentRevenueStats = pipelineStats?.revenueBreakdown?.[revenueTimeRange] || {
     revenue: totalRevenue,
     salesValue: totalEnrolledFees,
     count: totalEnrolledCount
  };

  const pipelineData = pipelineStats?.funnelBreakdown || [];
  const winRate = pipelineStats?.winRate ? Math.round(pipelineStats.winRate) : 0;
  const activeUsers = pipelineStats?.activeUsers || 0;
  const presentUsers = pipelineStats?.presentUsers || 0;
  const onTimeUsers = pipelineStats?.onTimeUsers || 0;
  const leadVelocity = pipelineStats?.leadVelocity || 0;
  const unclosedLeads = pipelineStats?.unclosedLeads || 0;
  const punchedLeads = pipelineStats?.punchedLeads || 0;
  const universityBreakdown = pipelineStats?.universityBreakdown || [];

  if (loading) return <MissionControlSkeleton />;
  
  if (error) {
     return (
       <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-slate-900">Data Unavailable</h2>
            <p className="text-slate-500 mt-2">{error}</p>
            <button onClick={() => window.location.reload()} className="mt-4 text-indigo-600 hover:text-indigo-500">Retry</button>
          </div>
       </div>
     );
  }

  return (
    <AuthGate allowedOrgRoles={["SUPER_ADMIN"]}>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <div className="mx-auto max-w-7xl px-6 pt-10 pb-24">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Global Command</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Mission Control</h1>
            </div>
            <div className="flex gap-2">
              <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-600 shadow-sm ring-1 ring-slate-200">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                System Operational
              </div>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 auto-rows-[180px]">
            {/* Revenue Card - Wide */}
            <Bento className="md:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <CurrencyRupeeIcon className="h-5 w-5 text-indigo-500" />
                  <span className="text-sm font-semibold tracking-tight text-slate-900">Revenue Velocity</span>
                </div>
                <div className="flex bg-slate-100 rounded-lg p-1">
                    {(['today', 'weekly', 'monthly', 'total'] as const).map((range) => (
                        <button
                            key={range}
                            onClick={() => setRevenueTimeRange(range)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                                revenueTimeRange === range 
                                    ? 'bg-white text-indigo-600 shadow-sm' 
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {range.charAt(0).toUpperCase() + range.slice(1)}
                        </button>
                    ))}
                </div>
              </div>
              <div className="flex items-end justify-between">
                <div>
                   <div className="text-4xl font-bold tabular-nums text-slate-900">₹{Intl.NumberFormat('en-IN').format(currentRevenueStats.revenue)}</div>
                   <div className="mt-1 text-sm text-slate-500">Revenue (35%)</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-indigo-600">₹{Intl.NumberFormat('en-IN', { notation: "compact", maximumFractionDigits: 1 }).format(currentRevenueStats.salesValue)}</div>
                  <div className="text-xs text-slate-500">{currentRevenueStats.count} Enrolled Candidates</div>
                </div>
              </div>
            </Bento>

            {/* Win Rate KPI */}
            <KPICard 
              title="Win Rate" 
              value={`${winRate}%`} 
              subtext="Conversion from Closed" 
              icon={ChartBarIcon} 
              colorClass="text-emerald-500" 
            />

            {/* Active Users KPI */}
            <Bento>
              <div className="flex items-center gap-2 mb-2">
                <SignalIcon className="h-5 w-5 text-indigo-500" />
                <span className="text-sm font-semibold tracking-tight text-slate-900">Active Users</span>
              </div>
              <div className="mt-2 space-y-3">
                {/* Total Active */}
                <div>
                   <motion.div 
                     initial={{ scale: 0.95, opacity: 0.5 }} 
                     animate={{ scale: 1, opacity: 1 }}
                     className="text-3xl font-bold tabular-nums text-slate-900"
                   >
                     {activeUsers}
                   </motion.div>
                   <div className="text-xs text-slate-500 mt-1">Total Active</div>
                </div>
                
                {/* Breakdown */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                  <div>
                    <div className="text-lg font-semibold text-slate-700">{presentUsers}</div>
                    <div className="text-[10px] text-emerald-600 font-medium uppercase tracking-wide">Present</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-slate-700">{onTimeUsers}</div>
                    <div className="text-[10px] text-indigo-600 font-medium uppercase tracking-wide">On Time</div>
                  </div>
                </div>
              </div>
            </Bento>

            {/* Lead Inspector - Removed old Bento component as it is now a full section below */}


            {/* Hierarchy Tree */}
            <Bento className="md:col-span-2 row-span-2">
              <HierarchyTree data={treeData} />
            </Bento>

            {/* Lead Velocity KPI */}
            <Bento className="row-span-2">
               <div className="flex items-center gap-2 mb-4">
                 <BoltIcon className="h-5 w-5 text-amber-500" />
                 <span className="text-sm font-semibold tracking-tight text-slate-900">Lead Velocity</span>
               </div>
               
               <div className="grid grid-cols-2 gap-4">
                 {/* New Today - Large Emphasis */}
                 <div className="col-span-2 rounded-xl bg-amber-50/50 p-4 border border-amber-100">
                   <div className="text-3xl font-bold tabular-nums text-slate-900">{leadVelocity}</div>
                   <div className="text-xs font-medium text-amber-700 mt-1">New Leads Today</div>
                 </div>

                 {/* Contacted Leads */}
                 <div className="col-span-2 rounded-xl bg-blue-50/50 p-4 border border-blue-100">
                   <div className="text-3xl font-bold tabular-nums text-slate-900">{punchedLeads}</div>
                   <div className="text-xs font-medium text-blue-700 mt-1">Contacted Leads</div>
                 </div>

                 {/* Unclosed */}
                 <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                   <div className="text-xl font-bold tabular-nums text-slate-900">{pipelineStats?.unclosedLeads || 0}</div>
                   <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mt-1">Unclosed</div>
                 </div>

                 {/* Closed */}
                 <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                   <div className="text-xl font-bold tabular-nums text-slate-900">{pipelineStats?.enrollmentGeneratedCount || 0}</div>
                   <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mt-1">Closed</div>
                 </div>
               </div>
            </Bento>

            {/* Pipeline Funnel */}
            <Bento className="row-span-2">
              <div className="flex items-center gap-2 mb-4">
                <PresentationChartLineIcon className="h-5 w-5 text-indigo-500" />
                <span className="text-sm font-semibold tracking-tight text-slate-900">Pipeline Health</span>
              </div>
              <div className="h-[250px] w-full">
                <ResponsiveContainer>
                  <FunnelChart>
                    <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }} />
                    <Funnel dataKey="value" data={pipelineData} isAnimationActive>
                      {pipelineData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="none" />
                      ))}
                    </Funnel>
                  </FunnelChart>
                </ResponsiveContainer>
              </div>
            </Bento>

            {/* University Revenue Breakdown - Bento Card */}
            <Bento className="md:col-span-2 row-span-2">
               <UniversityRevenueCard 
                 breakdown={universityBreakdown} 
                 onUniversityClick={(uni) => {
                   setSelectedUniversity(uni);
                   setIsUniversityModalOpen(true);
                 }}
               />
            </Bento>

            {/* Activity Feed */}
            <Bento className="md:col-span-2 row-span-2">
               <ActivityFeed feed={activityFeed} />
            </Bento>
          </div>

          <div className="mt-12">
            <LeadInspector 
              onViewDetails={(lead) => {
                setSelectedLead(lead);
                setIsPanelOpen(true);
              }}
            />
          </div>

          {/* Modals */}
          {selectedUniversity && (
            <UniversityLeadsModal
              isOpen={isUniversityModalOpen}
              onClose={() => setIsUniversityModalOpen(false)}
              universityName={selectedUniversity.name}
              leads={selectedUniversity.leads}
            />
          )}

          {userDoc && (
            <LeadDetailPanel
              isOpen={isPanelOpen}
              onClose={() => setIsPanelOpen(false)}
              lead={selectedLead}
              currentUser={userDoc}
              userRole={userDoc.role}
            />
          )}

        </div>
      </div>
    </AuthGate>
  );
}