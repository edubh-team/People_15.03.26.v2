"use client";

import { useState, useMemo, Fragment } from "react";
import { UserDoc } from "@/lib/types/user";
import { Dialog, Transition } from "@headlessui/react";
import { 
  ExclamationTriangleIcon, 
  UserPlusIcon, 
  AdjustmentsHorizontalIcon, 
  EnvelopeIcon, 
} from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthProvider";
import { AuthGate } from "@/components/auth/AuthGate";
import { createEmployee, updateEmployeeLifecycle } from "@/app/actions/hr";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { GlassButton } from "@/components/ui/GlassButton";
import Select from "@/components/ui/Select";
import SearchableCombobox from "@/components/ui/Combobox";
import Pagination from "@/components/ui/Pagination";
import { RoleBadge } from "@/components/RoleBadge";
import { isAdminUser, isHrUser, isManagerUser } from "@/lib/access";
import {
  PeopleDirectoryFiltersBar,
  PeopleDirectoryStatsStrip,
  PeopleStatusBadge,
  PeopleUserAvatar,
} from "@/components/people/PeopleDirectoryShared";
import {
  filterPeopleDirectoryUsers,
  paginatePeopleDirectoryUsers,
  usePeopleDirectoryData,
  buildPeopleDirectoryStats,
} from "@/lib/people/directory";

// --- Main Page Component ---

export default function EmployeeManagementPage() {
  const { firebaseUser } = useAuth();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { visibleUsers: employees, supervisors, loading, error } = usePeopleDirectoryData({
    includeExecutiveControl: false,
    sortMode: "display_name",
  });

  // Lifecycle State
  const [isLifecycleOpen, setIsLifecycleOpen] = useState(false);
  const [targetUser, setTargetUser] = useState<UserDoc | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<"deactivate" | "inactive_till" | "terminate">("deactivate");
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [inactiveUntil, setInactiveUntil] = useState("");
  const [isApplyingLifecycle, setIsApplyingLifecycle] = useState(false);

  // Onboarding State
  // Initialize from URL params to avoid useEffect setState warning
  const [isOnboardOpen, setIsOnboardOpen] = useState(() => {
    return !!(searchParams.get("name") || searchParams.get("email"));
  });
  const [newEmployee, setNewEmployee] = useState(() => ({
    name: searchParams.get("name") || "",
    email: searchParams.get("email") || "",
    role: "employee",
    password: "",
    supervisorId: ""
  }));
  const [isCreating, setIsCreating] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{email: string, password: string} | null>(null);

  const openLifecycleModal = (user: UserDoc, action: "deactivate" | "inactive_till" | "terminate") => {
    setTargetUser(user);
    setLifecycleAction(action);
    setLifecycleReason("");
    setInactiveUntil("");
    setIsLifecycleOpen(true);
  };

  const handleApplyLifecycle = async () => {
    if (!targetUser || !firebaseUser) return;
    setIsApplyingLifecycle(true);
    
    const token = await firebaseUser.getIdToken();
    const result = await updateEmployeeLifecycle({
      targetUid: targetUser.uid,
      action: lifecycleAction,
      reason: lifecycleReason,
      callerIdToken: token,
      inactiveUntil: lifecycleAction === "inactive_till" ? inactiveUntil : null,
    });
    
    setIsApplyingLifecycle(false);
    if (result.success) {
        setIsLifecycleOpen(false);
        setTargetUser(null);
        setLifecycleReason("");
        setInactiveUntil("");
        alert(
          [
            result.message || "Lifecycle action applied.",
            typeof result.transferredLeads === "number"
              ? `Active leads transferred: ${result.transferredLeads}.`
              : null,
          ]
            .filter(Boolean)
            .join(" "),
        );
    } else {
        alert("Error: " + result.error);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setIsCreating(true);

    const token = await firebaseUser.getIdToken();
    const result = await createEmployee(newEmployee, token);

    setIsCreating(false);
    if (result.success) {
        setCreatedCredentials({ email: newEmployee.email, password: result.password || "" });
    } else {
        alert("Error: " + result.error);
    }
  };

  const filteredEmployees = useMemo(() => (
    filterPeopleDirectoryUsers(employees, { searchTerm, roleFilter, statusFilter })
  ), [employees, roleFilter, searchTerm, statusFilter]);

  const paginatedEmployees = useMemo(() => (
    paginatePeopleDirectoryUsers(filteredEmployees, currentPage, itemsPerPage)
  ), [filteredEmployees, currentPage]);

  const stats = useMemo(() => buildPeopleDirectoryStats(employees), [employees]);

  return (
    <AuthGate allowIf={(user) => isHrUser(user) || isManagerUser(user) || isAdminUser(user)}>
    <div className="min-h-screen bg-slate-50/50 p-4 sm:p-6 lg:p-8 space-y-8">
      
      {/* Header & Stats */}
      <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Employee Management</h1>
          <p className="mt-2 text-slate-500">Manage your organization&apos;s workforce, roles, and access.</p>
        </div>
        <div className="flex gap-4">
          <GlassButton onClick={() => setIsOnboardOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200">
            <UserPlusIcon className="w-5 h-5" />
            <span className="hidden sm:inline">Onboard Employee</span>
            <span className="sm:hidden">Add</span>
          </GlassButton>
        </div>
      </div>

      <PeopleDirectoryStatsStrip stats={stats} />

      <PeopleDirectoryFiltersBar
        searchTerm={searchTerm}
        roleFilter={roleFilter}
        statusFilter={statusFilter}
        onSearchTermChange={(value) => {
          setSearchTerm(value);
          setCurrentPage(1);
        }}
        onRoleFilterChange={(value) => {
          setRoleFilter(value);
          setCurrentPage(1);
        }}
        onStatusFilterChange={(value) => {
          setStatusFilter(value);
          setCurrentPage(1);
        }}
      />

      {/* Employee List */}
      <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-900/5 overflow-hidden">
        {loading ? (
           <div className="p-12 text-center">
             <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
             <p className="mt-4 text-slate-500">Loading employees...</p>
           </div>
        ) : error ? (
           <div className="p-12 text-center text-rose-600">{error.message}</div>
        ) : filteredEmployees.length === 0 ? (
           <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
             <div className="rounded-full bg-slate-50 p-6 mb-4">
               <UserPlusIcon className="h-10 w-10 text-slate-300" />
             </div>
             <h3 className="text-lg font-semibold text-slate-900">No employees found</h3>
             <p className="mt-1 text-slate-500 max-w-sm">
               We couldn&apos;t find any employees matching your search criteria. Try adjusting your filters.
             </p>
             <button 
               onClick={() => { setSearchTerm(""); setRoleFilter("all"); }}
               className="mt-6 text-sm font-medium text-indigo-600 hover:text-indigo-500"
             >
               Clear all filters
             </button>
           </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Employee</th>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Role</th>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                    <th scope="col" className="relative px-6 py-4"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {paginatedEmployees.map((person) => (
                    <tr key={person.uid} className="group hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10">
                            <PeopleUserAvatar user={person} />
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-slate-900">{person.displayName || "Unknown Name"}</div>
                            <div className="text-sm text-slate-500 flex items-center gap-1">
                                <EnvelopeIcon className="w-3 h-3" />
                                {person.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <RoleBadge role={person.orgRole ?? person.role} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <PeopleStatusBadge status={(person.status || "inactive").toLowerCase()} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => openLifecycleModal(person, "deactivate")}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          title="Lifecycle actions"
                        >
                          <AdjustmentsHorizontalIcon className="h-4 w-4" />
                          Lifecycle
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-slate-200">
                {paginatedEmployees.map((person) => (
                    <div key={person.uid} className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <PeopleUserAvatar user={person} size="md" />
                                <div>
                                    <h3 className="text-sm font-medium text-slate-900">{person.displayName}</h3>
                                    <p className="text-xs text-slate-500">{person.email}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => openLifecycleModal(person, "deactivate")}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                            >
                                Lifecycle
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <RoleBadge role={person.orgRole ?? person.role} />
                            <PeopleStatusBadge status={(person.status || "inactive").toLowerCase()} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Pagination Controls */}
            <div className="border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
              <Pagination
                currentPage={currentPage}
                itemsPerPage={itemsPerPage}
                totalCurrentItems={paginatedEmployees.length}
                totalItems={filteredEmployees.length}
                hasMore={currentPage * itemsPerPage < filteredEmployees.length}
                loading={loading}
                onPrev={() => setCurrentPage(p => Math.max(1, p - 1))}
                onNext={() => setCurrentPage(p => p + 1)}
                label="employees"
              />
            </div>
          </>
        )}
      </div>

      {/* Lifecycle Modal */}
      <Transition appear show={isLifecycleOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsLifecycleOpen(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                  <div className="flex items-center gap-4 text-rose-600 mb-6">
                    <div className="p-3 bg-rose-100 rounded-full">
                        <ExclamationTriangleIcon className="w-6 h-6" />
                    </div>
                    <Dialog.Title as="h3" className="text-lg font-bold text-slate-900 leading-6">
                      Employee Lifecycle Action
                    </Dialog.Title>
                  </div>
                  
                  <div className="mt-2">
                    <p className="text-sm text-slate-500">
                      Apply lifecycle change for <span className="font-semibold text-slate-900">{targetUser?.displayName}</span>. 
                      Employee data remains preserved and searchable. Deactivate or terminate will auto-transfer active leads to reporting manager with full custody timeline.
                    </p>
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Action</label>
                    <select
                      value={lifecycleAction}
                      onChange={(event) => setLifecycleAction(event.target.value as "deactivate" | "inactive_till" | "terminate")}
                      className="w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                    >
                      <option value="deactivate">Deactivate</option>
                      <option value="inactive_till">Inactive till date</option>
                      <option value="terminate">Terminate</option>
                    </select>
                  </div>

                  {lifecycleAction === "inactive_till" ? (
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Inactive till</label>
                      <input
                        type="datetime-local"
                        value={inactiveUntil}
                        onChange={(event) => setInactiveUntil(event.target.value)}
                        className="w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      />
                    </div>
                  ) : null}

                  <div className="mt-4">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
                    <textarea 
                        placeholder="Please provide a reason..."
                        className="w-full border-slate-300 rounded-lg shadow-sm focus:border-rose-500 focus:ring-rose-500 text-sm min-h-[100px]"
                        value={lifecycleReason}
                        onChange={e => setLifecycleReason(e.target.value)}
                    />
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      className="inline-flex justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                      onClick={() => setIsLifecycleOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="inline-flex justify-center rounded-lg border border-transparent bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed"
                      onClick={handleApplyLifecycle}
                      disabled={
                        !lifecycleReason.trim() ||
                        isApplyingLifecycle ||
                        (lifecycleAction === "inactive_till" && !inactiveUntil)
                      }
                    >
                      {isApplyingLifecycle ? (
                          <div className="flex items-center gap-2">
                              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              <span>Processing...</span>
                          </div>
                      ) : "Apply action"}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Onboarding Modal */}
      <Transition appear show={isOnboardOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsOnboardOpen(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-2xl bg-white p-8 text-left align-middle shadow-xl transition-all">
                  <div className="flex justify-between items-start mb-6">
                      <div>
                        <Dialog.Title as="h3" className="text-xl font-bold text-slate-900">
                            Onboard New Employee
                        </Dialog.Title>
                        <p className="text-sm text-slate-500 mt-1">Create a new account for an employee.</p>
                      </div>
                      <div className="h-10 w-10 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600">
                          <UserPlusIcon className="w-6 h-6" />
                      </div>
                  </div>
             
                  {!createdCredentials ? (
                      <form onSubmit={handleCreate} className="space-y-5">
                        <div className="grid grid-cols-1 gap-5">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                                <input 
                                    required 
                                    className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm py-2.5" 
                                    placeholder="e.g. John Doe"
                                    value={newEmployee.name} 
                                    onChange={e => setNewEmployee({...newEmployee, name: e.target.value})} 
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                                <input 
                                    required 
                                    type="email" 
                                    className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm py-2.5" 
                                    placeholder="john.doe@company.com"
                                    value={newEmployee.email} 
                                    onChange={e => setNewEmployee({...newEmployee, email: e.target.value})} 
                                />
                            </div>
                            <div>
                                <Select
                                    label="Role"
                                    value={newEmployee.role}
                                    onChange={(val) => setNewEmployee({...newEmployee, role: val})}
                                    options={[
                                        { value: "employee", label: "Employee" },
                                        { value: "teamLead", label: "Team Lead" },
                                        { value: "manager", label: "Manager" },
                                        { value: "HR", label: "HR" },
                                        { value: "financer", label: "Financer" }
                                    ]}
                                />
                            </div>
                            <div>
                                <SearchableCombobox
                                    label="Supervisor (Optional)"
                                    value={newEmployee.supervisorId}
                                    onChange={(val) => setNewEmployee({...newEmployee, supervisorId: val})}
                                    options={[
                                        { value: "", label: "No Supervisor" },
                                        ...supervisors.map(s => ({
                                            value: s.uid,
                                            label: `${s.displayName} (${s.role})`
                                        }))
                                    ]}
                                    placeholder="Search supervisor..."
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Temporary Password <span className="text-slate-400 font-normal">(Optional)</span></label>
                                <input 
                                    className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm py-2.5" 
                                    placeholder="Leave blank to auto-generate" 
                                    value={newEmployee.password} 
                                    onChange={e => setNewEmployee({...newEmployee, password: e.target.value})} 
                                />
                            </div>
                        </div>

                        <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-slate-100">
                            <button
                                type="button"
                                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg"
                                onClick={() => setIsOnboardOpen(false)}
                            >
                                Cancel
                            </button>
                            <button 
                                type="submit" 
                                disabled={isCreating} 
                                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium shadow-sm shadow-indigo-200"
                            >
                                {isCreating ? "Creating Account..." : "Create Account"}
                            </button>
                        </div>
                      </form>
                  ) : (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-emerald-50 p-6 rounded-xl border border-emerald-100 text-center"
                      >
                        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600">
                            <UserPlusIcon className="w-8 h-8" />
                        </div>
                        <h3 className="text-xl font-bold text-emerald-900 mb-2">Account Created Successfully</h3>
                        <p className="text-sm text-emerald-700 mb-6">The employee account has been set up. Please share these credentials securely.</p>
                        
                        <div className="bg-white rounded-lg border border-emerald-100 p-4 text-left space-y-3 shadow-sm">
                            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                                <span className="text-sm text-slate-500">Email</span>
                                <span className="font-mono text-sm font-medium text-slate-900 select-all">{createdCredentials.email}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-slate-500">Password</span>
                                <span className="font-mono text-sm font-medium text-slate-900 select-all bg-slate-50 px-2 py-1 rounded">{createdCredentials.password}</span>
                            </div>
                        </div>
                        
                        <button 
                            onClick={() => { setIsOnboardOpen(false); setCreatedCredentials(null); setNewEmployee({name:"", email:"", role:"employee", password:"", supervisorId:""}); }} 
                            className="mt-6 w-full bg-emerald-600 text-white py-2.5 rounded-lg hover:bg-emerald-700 font-medium shadow-sm"
                        >
                            Done & Close
                        </button>
                      </motion.div>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
    </AuthGate>
  );
}
