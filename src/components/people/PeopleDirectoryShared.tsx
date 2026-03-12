"use client";

import Image from "next/image";
import { BriefcaseIcon, FunnelIcon, IdentificationIcon, MagnifyingGlassIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import { RoleBadge } from "@/components/RoleBadge";
import { cn } from "@/lib/cn";
import { getPeopleRoleFilterOptions, type PeopleDirectoryStats } from "@/lib/people/directory";
import type { UserDoc } from "@/lib/types/user";

export function PeopleUserAvatar({
  user,
  size = "md",
}: {
  user: UserDoc;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizeClasses = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base",
    xl: "h-16 w-16 text-lg",
  };

  if (user.photoURL) {
    return (
      <div className={cn("relative overflow-hidden rounded-full border border-slate-200", sizeClasses[size])}>
        <Image src={user.photoURL} alt={user.displayName || "User"} fill className="object-cover" />
      </div>
    );
  }

  const initials = (user.displayName || user.email || "?")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const colors = [
    "bg-red-100 text-red-600",
    "bg-orange-100 text-orange-600",
    "bg-amber-100 text-amber-600",
    "bg-green-100 text-green-600",
    "bg-emerald-100 text-emerald-600",
    "bg-teal-100 text-teal-600",
    "bg-cyan-100 text-cyan-600",
    "bg-sky-100 text-sky-600",
    "bg-blue-100 text-blue-600",
    "bg-indigo-100 text-indigo-600",
    "bg-violet-100 text-violet-600",
    "bg-pink-100 text-pink-600",
  ];
  const colorIndex = user.uid.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length;

  return (
    <div className={cn("flex items-center justify-center rounded-full font-bold tracking-tight", colors[colorIndex], sizeClasses[size])}>
      {initials}
    </div>
  );
}

export function PeopleStatusBadge({ status }: { status: string }) {
  const key = (status || "inactive").toLowerCase();
  const styles: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    inactive: "bg-slate-50 text-slate-700 ring-slate-600/20",
    terminated: "bg-rose-50 text-rose-700 ring-rose-600/20",
  };

  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset", styles[key] ?? styles.inactive)}>
      {key === "active" ? <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function PeopleDirectoryStatsStrip({ stats }: { stats: PeopleDirectoryStats }) {
  const cards = [
    { label: "Total Active", value: stats.totalActive, icon: UserCircleIcon, color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "Leadership", value: stats.leadership, icon: BriefcaseIcon, color: "text-purple-600", bg: "bg-purple-50" },
    { label: "Team Leads", value: stats.teamLeads, icon: IdentificationIcon, color: "text-blue-600", bg: "bg-blue-50" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className="overflow-hidden rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5 transition-all hover:shadow-md">
          <div className="flex items-center gap-4">
            <div className={cn("rounded-lg p-3", card.bg)}>
              <card.icon className={cn("h-6 w-6", card.color)} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">{card.label}</p>
              <p className="text-2xl font-bold text-slate-900">{card.value}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PeopleDirectoryFiltersBar({
  searchTerm,
  roleFilter,
  statusFilter,
  onSearchTermChange,
  onRoleFilterChange,
  onStatusFilterChange,
  compact = false,
}: {
  searchTerm: string;
  roleFilter: string;
  statusFilter: string;
  onSearchTermChange: (value: string) => void;
  onRoleFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-900/5", compact ? "p-3" : "items-center justify-between p-4 sm:flex-row")}>
      <div className={cn("relative", compact ? "w-full" : "w-full sm:w-96")}>
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <MagnifyingGlassIcon className="h-5 w-5 text-slate-400" />
        </div>
        <input
          type="text"
          placeholder="Search by name, email, or employee ID..."
          className="block w-full rounded-lg border-0 py-2.5 pl-10 pr-3 text-slate-900 ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
        />
      </div>

      <div className={cn("flex w-full items-center gap-3", compact ? "flex-col" : "sm:w-auto")}>
        <div className={cn("flex items-center gap-3", compact ? "w-full" : "")}>
          <FunnelIcon className="h-5 w-5 text-slate-400" />
          <select
            className="block w-full rounded-lg border-0 py-2.5 pl-3 pr-10 text-slate-900 ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value)}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="terminated">Terminated</option>
          </select>
          <select
            className="block w-full rounded-lg border-0 py-2.5 pl-3 pr-10 text-slate-900 ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
            value={roleFilter}
            onChange={(event) => onRoleFilterChange(event.target.value)}
          >
            {getPeopleRoleFilterOptions().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export function PeopleDirectoryList({
  users,
  selectedUid,
  onSelect,
  emptyLabel,
}: {
  users: UserDoc[];
  selectedUid?: string | null;
  onSelect: (user: UserDoc) => void;
  emptyLabel: string;
}) {
  if (users.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {users.map((user) => (
        <button
          type="button"
          key={user.uid}
          className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
            selectedUid === user.uid
              ? "border-indigo-200 bg-indigo-50 ring-1 ring-indigo-200"
              : "border-slate-200 bg-white hover:border-indigo-200"
          }`}
          onClick={() => onSelect(user)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <PeopleUserAvatar user={user} />
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-900">{user.displayName ?? user.email ?? user.uid}</div>
                <div className="truncate text-xs text-slate-500">{user.email ?? "No email"}</div>
                {user.employeeId ? <div className="mt-1 text-[10px] font-mono font-medium text-slate-400">#{user.employeeId}</div> : null}
              </div>
            </div>
            <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${(user.status ?? "inactive") === "active" ? "bg-emerald-500" : "bg-rose-500"}`} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <RoleBadge role={user.orgRole ?? user.role} />
            <PeopleStatusBadge status={(user.status ?? "inactive").toLowerCase()} />
          </div>
        </button>
      ))}
    </div>
  );
}
