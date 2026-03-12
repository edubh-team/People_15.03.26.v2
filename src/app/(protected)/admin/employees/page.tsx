"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { useUpdateUser } from "@/lib/hooks/useUsers";
import { useTeamManagementScope } from "@/lib/hooks/useTeamManagementScope";
import { RoleBadge } from "@/components/RoleBadge";
import type { UserAccountStatus, UserRole, UserDoc } from "@/lib/types/user";
import { useQueryClient } from "@tanstack/react-query";
import { MagnifyingGlassIcon, UserPlusIcon, UsersIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";

const roles: { label: string; value: UserRole }[] = [
  { label: "Admin", value: "admin" },
  { label: "Manager", value: "manager" }, // Added Manager
  { label: "Team Lead", value: "teamLead" },
  { label: "Employee", value: "employee" },
  { label: "Financer", value: "financer" },
];

const statuses: { label: string; value: UserAccountStatus }[] = [
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
];

function ReportsToSelect({
  currentReportsTo,
  targetUserRole,
  allUsers,
  onSave,
  className,
  disabled,
}: {
  currentReportsTo: string | null;
  targetUserRole: UserRole;
  allUsers: UserDoc[];
  onSave: (next: string | null) => void;
  className: string;
  disabled?: boolean;
}) {
  // Filter Logic
  const options = useMemo(() => {
    // 1. Identify Target Role Level
    // Map role string to a comparable level or category
    const isTargetManager = targetUserRole === "manager" || targetUserRole === "MANAGER";
    const isTargetFinancer = targetUserRole === "financer" || targetUserRole === "FINANCER";
    
    return allUsers.filter(u => {
      const uRole = (u.role || "").toLowerCase();
      const uOrgRole = (u.orgRole || "").toUpperCase();
      
      // Rule 1: If User is Manager or Financer, they must report to Super Admin
      if (isTargetManager || isTargetFinancer) {
        return uRole === "admin" || uOrgRole === "SUPER_ADMIN";
      }
      
      // Rule 2: If User is Staff (Employee/TeamLead), they report to Team Lead or Manager (or Admin)
      const isManager = uRole === "manager" || uOrgRole === "MANAGER";
      const isTeamLead = uRole === "teamLead" || uOrgRole === "TEAM_LEAD";
      const isAdmin = uRole === "admin" || uOrgRole === "SUPER_ADMIN";
      
      return isManager || isTeamLead || isAdmin;
    });
  }, [allUsers, targetUserRole]);

  return (
    <select
      value={currentReportsTo ?? ""}
      onChange={(e) => {
        const val = e.target.value;
        onSave(val || null);
      }}
      className={className}
      disabled={disabled}
    >
      <option value="">(No Manager)</option>
      {options.map(u => (
        <option key={u.uid} value={u.uid}>
          {u.displayName || u.email || u.uid} ({u.role})
        </option>
      ))}
    </select>
  );
}

export default function AdminEmployeesPage() {
  const router = useRouter();
  const { userDoc, firebaseUser } = useAuth();
  const { scopedUsers: users, loading: usersLoading } = useTeamManagementScope(userDoc);
  const queryClient = useQueryClient();
  
  const updateUser = useUpdateUser();

  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [newUid, setNewUid] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("employee");
  const [newStatus, setNewStatus] = useState<UserAccountStatus>("active");
  const [newTeamLeadId, setNewTeamLeadId] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | UserAccountStatus>("all");

  // Determine permissions
  const isManager = (userDoc?.role === "manager" || userDoc?.orgRole === "MANAGER");
  const isTeamLead = (userDoc?.role === "teamLead");
  const isAdmin = (userDoc?.role === "admin" || userDoc?.orgRole === "SUPER_ADMIN");
  
  // Team Leads are Read-Only (cannot create)
  const canCreate = !isTeamLead; 
  // Managers can only update/assign specific roles
  const canEdit = !isTeamLead; 

  // Filter roles based on permissions
  const availableRoles = useMemo(() => {
    if (isAdmin) return roles;
    if (isManager) return roles.filter(r => ["teamLead", "employee"].includes(r.value));
    return []; // Team Lead shouldn't be editing roles anyway
  }, [isAdmin, isManager]);

  // Helper to normalize roles for display matching
  const getNormalizedRole = (role: string): UserRole => {
    const r = role?.toLowerCase() ?? "";
    if (r.includes("admin")) return "admin";
    if (r.includes("manager")) return "manager";
    if (r.includes("team")) return "teamLead";
    if (r.includes("financ")) return "financer";
    return "employee";
  };

  const filtered = useMemo(() => {
    const all = users ?? [];
    const s = search.trim().toLowerCase();
    return all.filter((u) => {
      const normalizedRole = getNormalizedRole(u.role);
      if (roleFilter !== "all" && normalizedRole !== roleFilter) return false;
      const normalizedStatus = (u.status ?? "inactive").toLowerCase();
      if (statusFilter !== "all" && normalizedStatus !== statusFilter) return false;
      if (!s) return true;
      const hay = [
        u.uid,
        u.email ?? "",
        u.displayName ?? "",
        u.role,
        u.status,
        u.teamLeadId ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [roleFilter, search, statusFilter, users]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    
    setIsCreating(true);
    setCreateError(null);

    try {
        const token = await firebaseUser?.getIdToken();
        if (!token) throw new Error("Not authenticated");

        const res = await fetch("/api/users/create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                uid: newUid || undefined,
                email: newEmail,
                displayName: newDisplayName,
                role: newRole,
                status: newStatus,
                teamLeadId: newTeamLeadId.trim() ? newTeamLeadId.trim() : null,
            })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "Failed to create user");
        }

        alert("User created and invite email sent!");
        
        setNewUid("");
        setNewEmail("");
        setNewDisplayName("");
        setNewRole("employee");
        setNewStatus("active");
        setNewTeamLeadId("");
        
        // Refresh users list
        queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error occurred";
        setCreateError(message);
    } finally {
        setIsCreating(false);
    }
  }

  return (
    <AuthGate allowedRoles={["admin", "manager", "teamLead"]} allowedOrgRoles={["SUPER_ADMIN", "MANAGER", "TEAM_LEAD"]}>
      <div className="max-w-5xl mx-auto space-y-8 pb-12">
        <div>
          <button
            type="button"
            onClick={() => router.push("/admin")}
            className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Admin
          </button>
          <div className="mt-3 flex items-center gap-2 text-sm font-medium text-indigo-600">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-600"></span>
            {isManager ? "Manager Portal" : isTeamLead ? "Team Portal" : "Admin Portal"}
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            {isTeamLead ? "Team Roster" : "Employee Management"}
          </h1>
          <p className="mt-1 text-slate-500">
            {isTeamLead ? "View your team members and their reporting structure." : "Manage user roles, statuses, and reporting lines."}
          </p>
        </div>

        {/* Add / Upsert Form - Hidden for Team Leads */}
        {canCreate && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <UserPlusIcon className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-semibold text-slate-900">Add or Update Employee</h2>
            </div>
            <div className="p-6">
              <form onSubmit={onCreate} className="grid gap-6 sm:grid-cols-2">
                <label className="block">
                  <div className="text-xs font-medium text-slate-600">UID</div>
                  <input
                    value={newUid}
                    onChange={(e) => setNewUid(e.target.value)}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-indigo-500/20 focus:ring-4"
                    placeholder="Firebase Auth UID"
                    required
                  />
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-slate-600">Email</div>
                  <input
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    type="email"
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-indigo-500/20 focus:ring-4"
                    placeholder="user@company.com"
                  />
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-slate-600">Name</div>
                  <input
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-indigo-500/20 focus:ring-4"
                    placeholder="Full name"
                  />
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-slate-600">Reports To</div>
                  <ReportsToSelect
                    currentReportsTo={newTeamLeadId}
                    targetUserRole={newRole}
                    allUsers={users}
                    onSave={(next) => setNewTeamLeadId(next ?? "")}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-indigo-500/20 focus:ring-4"
                  />
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-slate-600">Role</div>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-indigo-500/20 focus:ring-4"
                  >
                    {availableRoles.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-slate-600">Status</div>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as UserAccountStatus)}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-indigo-500/20 focus:ring-4"
                  >
                    {statuses.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
                  >
                    {isCreating ? "Creating..." : "Create User"}
                  </button>
                  {createError ? (
                    <div className="mt-3 text-xs text-rose-700">
                      {createError}
                    </div>
                  ) : null}
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
             <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <UsersIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Employees Directory</h2>
                  <p className="text-xs text-slate-500">{filtered.length} members found</p>
                </div>
             </div>
             
             <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none ring-indigo-500/20 focus:ring-4 sm:w-64"
                    placeholder="Search by name, email, or role..."
                  />
                </div>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as "all" | UserRole)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:ring-4"
                >
                  <option value="all">All roles</option>
                  {roles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "all" | UserAccountStatus)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:ring-4"
                >
                  <option value="all">All status</option>
                  {statuses.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setRoleFilter("all");
                    setStatusFilter("all");
                  }}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Clear
                </button>
             </div>
          </div>

          <div className="p-0">
            {usersLoading ? (
              <div className="p-6 text-sm text-slate-500">Loading directory...</div>
            ) : (
              <>
                <div className="hidden sm:block">
                  <div className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/60">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50/80 text-xs font-medium text-slate-500 backdrop-blur">
                        <tr className="border-b border-slate-100/70">
                          <th className="px-6 py-3 font-semibold">User</th>
                          <th className="px-6 py-3 font-semibold">Role</th>
                          <th className="px-6 py-3 font-semibold">Status</th>
                          <th className="px-6 py-3 font-semibold">Reports To</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/80 bg-white">
                        {filtered.map((u, index) => (
                          <tr
                            key={u.uid}
                            className={`transition-colors ${
                              index % 2 === 0 ? "bg-white" : "bg-slate-50/40"
                            } hover:bg-slate-100/60`}
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold uppercase text-slate-50">
                                  {(u.displayName ?? u.email ?? "—")
                                    .split(" ")
                                    .map((part) => part[0])
                                    .join("")
                                    .slice(0, 2)}
                                </div>
                                <div>
                                  <div className="font-medium text-slate-900">
                                    {u.displayName ?? u.email ?? "—"}
                                  </div>
                                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5">
                                      {u.employeeId || u.uid}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="mt-2">
                                <RoleBadge role={u.role} />
                              </div>
                            </td>
                            <td className="px-6 py-4 align-middle">
                              <select
                                value={getNormalizedRole(u.role)}
                                onChange={(e) =>
                                  updateUser.mutate({
                                    uid: u.uid,
                                    role: e.target.value as UserRole,
                                  })
                                }
                                disabled={!canEdit}
                                className="h-9 w-full rounded-full border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:border-indigo-500 focus:ring-4 disabled:bg-slate-100 disabled:text-slate-500"
                              >
                                {availableRoles.map((r) => (
                                  <option key={r.value} value={r.value}>
                                    {r.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-6 py-4 align-middle">
                              <select
                                value={u.status}
                                onChange={(e) =>
                                  updateUser.mutate({
                                    uid: u.uid,
                                    status: e.target.value as UserAccountStatus,
                                  })
                                }
                                disabled={!canEdit}
                                className="h-9 w-full rounded-full border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:border-indigo-500 focus:ring-4 disabled:bg-slate-100 disabled:text-slate-500"
                              >
                                {statuses.map((s) => (
                                  <option key={s.value} value={s.value}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-6 py-4 align-middle">
                              <ReportsToSelect
                                key={`${u.uid}:${u.teamLeadId ?? ""}`}
                                currentReportsTo={u.teamLeadId ?? null}
                                targetUserRole={u.role}
                                allUsers={users}
                                onSave={(next) =>
                                  updateUser.mutate({
                                    uid: u.uid,
                                    teamLeadId: next,
                                  })
                                }
                                disabled={!canEdit}
                                className="h-9 w-full rounded-full border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:border-indigo-500 focus:ring-4 disabled:bg-slate-100 disabled:text-slate-500"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile View */}
                <div className="grid gap-4 p-4 sm:hidden bg-slate-50/50">
                  {filtered.map((u) => (
                    <div
                      key={u.uid}
                      className="rounded-xl border border-slate-200 bg-white p-4"
                    >
                      <div className="text-sm font-semibold tracking-tight">
                        {u.displayName ?? u.email ?? "—"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{u.employeeId || u.uid}</div>
                      <div className="mt-4 grid gap-3">
                        <label className="block">
                          <div className="text-xs font-medium text-slate-600">
                            Role
                          </div>
                          <select
                            value={getNormalizedRole(u.role)}
                            onChange={(e) =>
                              updateUser.mutate({
                                uid: u.uid,
                                role: e.target.value as UserRole,
                              })
                            }
                            disabled={!canEdit}
                            className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:ring-4 disabled:bg-slate-100"
                          >
                            {availableRoles.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <div className="text-xs font-medium text-slate-600">
                            Status
                          </div>
                          <select
                            value={u.status}
                            onChange={(e) =>
                              updateUser.mutate({
                                uid: u.uid,
                                status: e.target.value as UserAccountStatus,
                              })
                            }
                            disabled={!canEdit}
                            className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:ring-4 disabled:bg-slate-100"
                          >
                            {statuses.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <div className="text-xs font-medium text-slate-600">
                            Reports To
                          </div>
                          <ReportsToSelect
                            key={`${u.uid}:${u.teamLeadId ?? ""}`}
                            currentReportsTo={u.teamLeadId ?? null}
                            targetUserRole={u.role}
                            allUsers={users}
                            onSave={(next) =>
                              updateUser.mutate({
                                uid: u.uid,
                                teamLeadId: next,
                              })
                            }
                            disabled={!canEdit}
                            className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-500/20 focus:ring-4 disabled:bg-slate-100"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>

                {updateUser.error ? (
                  <div className="mt-4 text-xs text-rose-700">
                    {updateUser.error.message}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
