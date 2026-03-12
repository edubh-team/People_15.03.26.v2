"use client";

import { useState, useEffect, Fragment } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useDashboardMetrics, UniversityStat } from "@/lib/hooks/useDashboardMetrics";
import { DashboardCard, DashboardCardSkeleton } from "@/components/dashboard/DashboardCard";
import LeadDetailPanel from "@/components/leads/LeadDetailPanel";
import UniversityLeadsModal from "./_components/UniversityLeadsModal";
import { LeadDoc } from "@/lib/types/crm";
import { useAuth } from "@/components/auth/AuthProvider";
import Image from "next/image";
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import DirectSaleForm from "@/components/leads/DirectSaleForm";
import { CurrencyRupeeIcon } from "@heroicons/react/24/outline";
// import { useSecureCollection } from "@/lib/hooks/useSecureCollection";
import { isSameMonth } from "date-fns";
import { canManageTeam } from "@/lib/access";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from "recharts";

// Icons
function UsersIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function AttendanceIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
    </svg>
  );
}

export default function ManagerDashboard() {
  const { userDoc, firebaseUser } = useAuth();
  const { metrics, loading } = useDashboardMetrics();
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadDoc | null>(null);
  const [selectedUniversityStat, setSelectedUniversityStat] = useState<UniversityStat | null>(null);
  const [showDirectSaleModal, setShowDirectSaleModal] = useState(false);
  const [revenueTimeRange, setRevenueTimeRange] = useState<'today' | 'weekly' | 'monthly' | 'total'>('total');

  // useSecureCollection removed as we now get all data from useDashboardMetrics for consistency
  
  const universitySales = metrics.revenue.universityStats || [];

  const currentRevenueStats = metrics.revenue.breakdown?.[revenueTimeRange] || {
     revenue: 0,
     salesValue: 0,
     count: 0
  };

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumSignificantDigits: 3 }).format(val);


  return (
    <AuthGate allowIf={canManageTeam}>
      <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Executive Overview</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">Real-time insights across HR & CRM verticals.</p>
        </div>
        <div className="flex items-center gap-3">
            <button
                onClick={() => setShowDirectSaleModal(true)}
                className="group relative inline-flex items-center justify-center overflow-hidden rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 hover:scale-105 active:scale-95"
            >
                <span className="relative z-10">Punch New Sale</span>
            </button>
            <div className="flex items-center gap-2 rounded-full bg-white/60 px-3 py-1.5 backdrop-blur-md border border-slate-200/50 shadow-sm">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-semibold text-slate-600">Live</span>
            </div>
        </div>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4 auto-rows-min">
        
        {/* Total Workforce */}
        <div className="group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80 hover:-translate-y-1">
          <div className="flex items-start justify-between">
            <div className="rounded-2xl bg-violet-500/10 p-3 text-violet-600">
              <UsersIcon />
            </div>
            {loading && <div className="h-4 w-12 animate-pulse rounded bg-slate-200" />}
          </div>
          <div className="mt-4">
            <p className="text-sm font-medium text-slate-500">Total Workforce</p>
            <h3 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
              {loading ? "-" : metrics.totalWorkforce.total}
            </h3>
            <div className="mt-4 flex items-center gap-3 text-xs font-medium text-slate-500">
               <div className="flex items-center gap-1.5 bg-violet-50 px-2 py-1 rounded-lg border border-violet-100"><span className="h-1.5 w-1.5 rounded-full bg-violet-500"></span> {metrics.totalWorkforce.teamLeads} TL</div>
               <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100"><span className="h-1.5 w-1.5 rounded-full bg-slate-400"></span> {metrics.totalWorkforce.employees} Emp</div>
            </div>
          </div>
        </div>

        {/* Daily Attendance */}
        <div className="group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80 hover:-translate-y-1">
          <div className="flex items-start justify-between">
            <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-600">
              <AttendanceIcon />
            </div>
            {!loading && (
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                {metrics.attendance.present} / {metrics.attendance.total}
              </span>
            )}
          </div>
          <div className="mt-4">
            <p className="text-sm font-medium text-slate-500">Daily Attendance</p>
            <h3 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
              {loading ? "-" : `${metrics.attendance.percentage}%`}
            </h3>
            <div className="mt-4 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
               <div 
                 className="h-full rounded-full bg-emerald-500 transition-all duration-1000 ease-out" 
                 style={{ width: `${metrics.attendance.percentage}%` }} 
               />
            </div>
          </div>
        </div>

        {/* New Hires */}
        <div className="group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80 hover:-translate-y-1">
          <div className="flex items-start justify-between">
            <div className="rounded-2xl bg-blue-500/10 p-3 text-blue-600">
              <UserPlusIcon />
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
              +4 vs last mo.
            </span>
          </div>
          <div className="mt-4">
            <p className="text-sm font-medium text-slate-500">New Hires (Mo.)</p>
            <h3 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
              {loading ? "-" : metrics.newHires.count}
            </h3>
            <div className="mt-4 flex -space-x-2 overflow-hidden py-1">
              {metrics.newHires.recent.map((u, i) => (
                <Image 
                  key={u.uid || i}
                  className="inline-block h-8 w-8 rounded-full ring-2 ring-white object-cover bg-slate-100 transition-transform hover:scale-110 hover:z-10"
                  src={u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName || "U")}&background=random`}
                  alt={u.displayName || "User"}
                  width={32}
                  height={32}
                  unoptimized
                />
              ))}
              {metrics.newHires.count > 4 && (
                   <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 ring-2 ring-white text-xs font-medium text-slate-600">
                      +{metrics.newHires.count - 4}
                   </div>
              )}
            </div>
          </div>
        </div>

        {/* Revenue Tile */}
        {userDoc?.role !== 'teamLead' && (
          <div className="group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80 hover:-translate-y-1">
            {loading ? (
              <DashboardCardSkeleton />
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="rounded-2xl bg-indigo-500/10 p-3 text-indigo-600">
                      <CurrencyRupeeIcon className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="flex bg-slate-100/50 rounded-xl p-1 self-start backdrop-blur-sm">
                      {(['today', 'weekly', 'monthly', 'total'] as const).map((range) => (
                          <button
                              key={range}
                              onClick={() => setRevenueTimeRange(range)}
                              className={`px-2.5 py-1 text-[10px] font-semibold rounded-lg transition-all duration-200 ${
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
                <div className="mt-4">
                  <p className="text-sm font-medium text-slate-500">Revenue</p>
                  <div className="mt-1 flex items-baseline gap-2">
                     <div className="text-2xl font-bold tracking-tight text-slate-900">{formatCurrency(currentRevenueStats.revenue)}</div>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                    <div className="text-xs font-medium text-slate-500">{currentRevenueStats.count} Enrolled</div>
                    <div className="text-sm font-bold text-indigo-600">₹{Intl.NumberFormat('en-IN', { notation: "compact", maximumFractionDigits: 1 }).format(currentRevenueStats.salesValue)}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Revenue vs Target (Area Chart) - Spans 2 cols */}
        <div className="col-span-1 lg:col-span-2 row-span-2 rounded-[32px] border border-white/20 bg-white/60 p-8 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl">
             <div className="mb-8 flex items-center justify-between">
                 <div>
                    <h3 className="text-lg font-bold text-slate-900">Revenue Analytics</h3>
                    <p className="text-sm text-slate-500">Target vs Achieved Performance</p>
                 </div>
                 <div className="flex gap-4 text-xs font-medium text-slate-500 bg-slate-50/50 px-3 py-1.5 rounded-full backdrop-blur-sm">
                     <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500"></span> Target</span>
                     <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500"></span> Achieved</span>
                 </div>
             </div>
             <div className="h-[350px] w-full">
                {loading ? (
                    <div className="h-full w-full animate-pulse rounded-2xl bg-slate-50" />
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={metrics.revenue.history.length > 0 ? metrics.revenue.history : [
                            { name: 'Week 1', target: 300000, revenue: 250000 },
                            { name: 'Week 2', target: 300000, revenue: 320000 },
                            { name: 'Week 3', target: 300000, revenue: 280000 },
                            { name: 'Week 4', target: 300000, revenue: 400000 },
                        ]}>
                            <defs>
                                <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorTgt" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                            <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} tickFormatter={(val) => `₹${val/1000}k`} />
                            <Tooltip 
                                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', backgroundColor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(8px)' }}
                                itemStyle={{ fontSize: '12px', fontWeight: 600 }}
                            />
                            <Area type="monotone" dataKey="target" stroke="#3b82f6" fillOpacity={1} fill="url(#colorTgt)" strokeWidth={3} />
                            <Area type="monotone" dataKey="revenue" stroke="#10b981" fillOpacity={1} fill="url(#colorRev)" strokeWidth={3} />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
             </div>
        </div>

        {/* Lead Funnel (Bar Chart) */}
        <div className="col-span-1 row-span-2 rounded-[32px] border border-white/20 bg-white/60 p-8 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl">
             <h3 className="mb-2 text-lg font-bold text-slate-900">Lead Funnel</h3>
             <p className="mb-6 text-sm text-slate-500">Conversion Pipeline</p>
             <div className="h-[350px] w-full">
                 {loading ? (
                     <div className="h-full w-full animate-pulse rounded-2xl bg-slate-50" />
                 ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart 
                            layout="vertical" 
                            data={[
                                { name: 'New', value: metrics.leads.new, color: '#94a3b8' },
                                { name: 'Contacted', value: metrics.leads.contacted, color: '#60a5fa' },
                                { name: 'Interested', value: metrics.leads.interested, color: '#f59e0b' },
                                { name: 'Closed', value: metrics.leads.closed, color: '#10b981' },
                            ]}
                            barSize={40}
                        >
                            <XAxis type="number" hide />
                            <YAxis dataKey="name" type="category" width={70} tick={{fill: '#64748b', fontSize: 12, fontWeight: 500}} axisLine={false} tickLine={false} />
                            <Tooltip cursor={{fill: 'rgba(241, 245, 249, 0.5)'}} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                            <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                                {
                                    [
                                        { name: 'New', value: metrics.leads.new, color: '#94a3b8' },
                                        { name: 'Contacted', value: metrics.leads.contacted, color: '#60a5fa' },
                                        { name: 'Interested', value: metrics.leads.interested, color: '#f59e0b' },
                                        { name: 'Closed', value: metrics.leads.closed, color: '#10b981' },
                                    ].map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))
                                }
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                 )}
             </div>
        </div>

        {/* Daily Task Velocity */}
        <div className="group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80 hover:-translate-y-1">
             <div className="flex items-start justify-between">
                <div>
                   <h3 className="text-base font-bold text-slate-900">Task Velocity</h3>
                   <p className="text-xs text-slate-500">Completed vs Assigned</p>
                </div>
                <div className="rounded-full bg-indigo-50 p-2 text-indigo-600">
                   <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                   </svg>
                </div>
             </div>

             <div className="mt-6 space-y-4">
                 <div>
                     <div className="flex justify-between text-xs font-semibold text-slate-600 mb-2">
                         <span>Efficiency Rate</span>
                         <span>{metrics.tasks.assignedToday > 0 ? Math.round((metrics.tasks.completedToday / metrics.tasks.assignedToday) * 100) : 0}%</span>
                     </div>
                     <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                         <div 
                              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-1000"
                              style={{ width: `${metrics.tasks.assignedToday > 0 ? (metrics.tasks.completedToday / metrics.tasks.assignedToday) * 100 : 0}%` }}
                         />
                     </div>
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                     <div className="rounded-2xl bg-emerald-50/80 p-3 text-center">
                         <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Done</div>
                         <div className="text-xl font-bold text-emerald-700">{metrics.tasks.completedToday}</div>
                     </div>
                     <div className="rounded-2xl bg-blue-50/80 p-3 text-center">
                         <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Total</div>
                         <div className="text-xl font-bold text-blue-700">{metrics.tasks.assignedToday}</div>
                     </div>
                 </div>
             </div>
        </div>

        {/* Sales by University */}
        {userDoc?.role !== 'teamLead' && (
        <div className="group relative col-span-1 row-span-1 overflow-hidden rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80">
            <div className="mb-4 flex items-center justify-between">
               <div>
                  <h3 className="text-base font-bold text-slate-900">University Sales</h3>
                  <p className="text-xs text-slate-500">Top performers (Total)</p>
               </div>
               <div className="text-right">
                  <div className="text-lg font-bold text-indigo-600">{formatCurrency((universitySales ?? []).reduce((sum, u) => sum + u.salesValue, 0))}</div>
               </div>
            </div>
            
            <div className="mt-2 space-y-3 max-h-[200px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200">
                {loading ? (
                    <div className="space-y-2">
                        {[1,2,3].map(i => <div key={i} className="h-12 w-full animate-pulse rounded-xl bg-slate-50" />)}
                    </div>
                ) : (
                    <>
                        {(universitySales.length ? universitySales.slice(0, 6) : []).map((u) => (
                          <div 
                            key={u.university} 
                            onClick={() => setSelectedUniversityStat(u)}
                            className="flex items-center justify-between rounded-xl bg-slate-50/80 p-3 transition-colors hover:bg-slate-100 cursor-pointer"
                          >
                            <div>
                              <div className="text-xs font-semibold text-slate-900 line-clamp-1">{u.university}</div>
                              <div className="mt-0.5 inline-flex items-center rounded-md bg-white px-1.5 py-0.5 text-[9px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                                {u.enrolled} enrolled
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs font-bold text-slate-900">{formatCurrency(u.salesValue)}</div>
                            </div>
                          </div>
                        ))}
                        {(!loading && universitySales.length === 0) && (
                          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                            No enrolled candidates this month yet.
                          </div>
                        )}
                    </>
                )}
            </div>
        </div>
        )}

      </div>

      {/* Integrated Lead Detail Panel */}
      {userDoc && (
        <LeadDetailPanel
          isOpen={isPanelOpen}
          onClose={() => {
            setIsPanelOpen(false);
            setSelectedLead(null);
          }}
          lead={selectedLead}
          currentUser={userDoc}
          userRole={userDoc.orgRole ?? undefined}
        />
      )}
      {/* University Leads Modal */}
      {selectedUniversityStat && userDoc && (
        <UniversityLeadsModal
          isOpen={!!selectedUniversityStat}
          onClose={() => setSelectedUniversityStat(null)}
          universityName={selectedUniversityStat.university}
          leads={selectedUniversityStat.leads}
          currentUser={userDoc}
        />
      )}

      {/* Direct Sale Modal */}
      <Transition show={showDirectSaleModal} as={Fragment}>
        <Dialog onClose={() => setShowDirectSaleModal(false)} className="relative z-50">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
          </TransitionChild>

          <div className="fixed inset-0 flex items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="transform transition ease-in-out duration-300"
              enterFrom="scale-95 opacity-0"
              enterTo="scale-100 opacity-100"
              leave="transform transition ease-in-out duration-200"
              leaveFrom="scale-100 opacity-100"
              leaveTo="scale-95 opacity-0"
            >
              <DialogPanel className="w-full max-w-2xl transform overflow-hidden rounded-3xl bg-white shadow-2xl transition-all">
                <div className="border-b border-slate-100 bg-slate-50/50 px-8 py-6">
                  <DialogTitle className="text-xl font-bold text-slate-900">
                    Direct Sale Punch
                  </DialogTitle>
                  <p className="text-sm text-slate-500 mt-1">
                    Manually enter a sale for a walk-in or direct lead.
                  </p>
                </div>
                
                <div className="max-h-[80vh] overflow-y-auto p-8">
                  <DirectSaleForm
                    onSuccess={() => {
                      setShowDirectSaleModal(false);
                    }}
                    onCancel={() => setShowDirectSaleModal(false)}
                  />
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
      </div>
    </AuthGate>
  );
}
