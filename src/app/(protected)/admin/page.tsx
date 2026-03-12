"use client";

import { useState, Fragment } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import Link from "next/link";
import { UsersIcon, Cog6ToothIcon, IdentificationIcon } from "@heroicons/react/24/outline";
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import DirectSaleForm from "@/components/leads/DirectSaleForm";

export default function AdminPage() {
  const { userDoc } = useAuth();
  const [showDirectSaleModal, setShowDirectSaleModal] = useState(false);

  // Determine permissions
  const isManager = (userDoc?.role === "manager" || userDoc?.orgRole === "MANAGER");
  const isTeamLead = (userDoc?.role === "teamLead");
  const isAdmin = (userDoc?.role === "admin" || userDoc?.orgRole === "SUPER_ADMIN");

  return (
    <AuthGate allowedRoles={["admin", "manager", "teamLead"]} allowedOrgRoles={["SUPER_ADMIN", "MANAGER", "TEAM_LEAD"]}>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div>
           <div className="flex items-center gap-2 text-sm font-medium text-indigo-600">
             <span className="h-1.5 w-1.5 rounded-full bg-indigo-600"></span>
             {isManager ? "Manager Portal" : isTeamLead ? "Team Portal" : "Admin Portal"}
           </div>
           <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
             {isTeamLead ? "Team Overview" : "Organization Dashboard"}
           </h1>
           <p className="mt-1 text-slate-500">
             {isTeamLead 
               ? "View your team members and their status." 
               : "Manage your workforce and configure system settings."}
           </p>
          </div>
          <button
            onClick={() => setShowDirectSaleModal(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
          >
            Punch New Sale
          </button>
        </div>

        {/* User Profile Card */}
        <div className="overflow-hidden rounded-[32px] border border-white/20 bg-white/60 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-md">
          <div className="border-b border-white/10 bg-white/50 px-6 py-4">
             <h2 className="text-sm font-semibold text-slate-900">Current Session</h2>
          </div>
          <div className="p-6">
            <div className="flex items-start gap-4">
               <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
                 <IdentificationIcon className="h-6 w-6" />
               </div>
               <div className="space-y-1">
                 <div className="font-medium text-slate-900 text-lg">
                   {userDoc?.displayName || userDoc?.email || "Admin User"}
                 </div>
                 <div className="flex flex-wrap gap-2">
                   <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700 border border-purple-100 capitalize">
                     {userDoc?.role}
                   </span>
                   <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-100 capitalize">
                     {userDoc?.status}
                   </span>
                 </div>
                 <div className="pt-2 text-xs font-mono text-slate-400">
                   UID: {userDoc?.uid}
                 </div>
               </div>
            </div>
          </div>
        </div>

        {/* Quick Actions Grid */}
        <div className="grid gap-6 sm:grid-cols-2">
          <Link
            href="/admin/employees"
            className="group relative overflow-hidden rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80 hover:-translate-y-1"
          >
            <div className="absolute right-0 top-0 -mr-6 -mt-6 h-24 w-24 rounded-full bg-indigo-50 opacity-0 transition-opacity group-hover:opacity-100" />
            
            <div className="relative">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-300">
                <UsersIcon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                {isTeamLead ? "My Team" : "Employee Management"}
              </h3>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                {isTeamLead 
                  ? "View your team members and their current status."
                  : "Set roles, update statuses, and configure reporting hierarchies."}
              </p>
            </div>
          </Link>

          {isAdmin && (
            <Link
              href="/admin/settings"
              className="group relative overflow-hidden rounded-[32px] border border-white/20 bg-white/60 p-6 shadow-sm backdrop-blur-2xl transition-all duration-300 hover:shadow-xl hover:bg-white/80 hover:-translate-y-1"
            >
              <div className="absolute right-0 top-0 -mr-6 -mt-6 h-24 w-24 rounded-full bg-indigo-50 opacity-0 transition-opacity group-hover:opacity-100" />

              <div className="relative">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-300">
                  <Cog6ToothIcon className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                  Admin Settings
                </h3>
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                  Configure system-wide policies, defaults, and application preferences.
                </p>
              </div>
            </Link>
          )}
        </div>
      </div>

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
              <DialogPanel className="w-full max-w-2xl transform overflow-hidden rounded-[32px] border border-white/20 bg-white/90 shadow-2xl backdrop-blur-2xl transition-all">
                <div className="border-b border-white/10 bg-white/50 px-6 py-4">
                  <DialogTitle className="text-lg font-bold text-slate-900">
                    Direct Sale Punch
                  </DialogTitle>
                  <p className="text-xs text-slate-500 mt-1">
                    Manually enter a sale for a walk-in or direct lead.
                  </p>
                </div>
                
                <div className="max-h-[80vh] overflow-y-auto p-6">
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
    </AuthGate>
  );
}
