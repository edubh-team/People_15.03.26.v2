import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { canReadSalesScope, getSalesHierarchyRank, sortUsersByHierarchy } from "@/lib/sales/hierarchy";
import { normalizeRoleValue } from "@/lib/access";
import { db, isFirebaseReady } from "@/lib/firebase/client";
import type { UserDoc } from "@/lib/types/user";

export type PeopleDirectorySortMode = "display_name" | "created_desc";

export type PeopleDirectoryFilters = {
  searchTerm: string;
  roleFilter: string;
  statusFilter: string;
};

export type PeopleDirectoryStats = {
  totalActive: number;
  leadership: number;
  teamLeads: number;
  hr: number;
  finance: number;
};

export type UsePeopleDirectoryOptions = {
  includeExecutiveControl?: boolean;
  sortMode?: PeopleDirectorySortMode;
  refreshKey?: string | number | boolean | null;
};

export type UsePeopleDirectoryResult = {
  allUsers: UserDoc[];
  visibleUsers: UserDoc[];
  supervisors: UserDoc[];
  hrUsers: UserDoc[];
  loading: boolean;
  error: Error | null;
};

const EXECUTIVE_CONTROL_ROLES = new Set(["SUPER_ADMIN", "ADMIN"]);

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && value !== null && "seconds" in value) {
    return ((value as { seconds: number }).seconds ?? 0) * 1000;
  }
  const parsed = new Date(value as string | number).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortPeopleDirectoryUsers(users: UserDoc[], mode: PeopleDirectorySortMode) {
  const rows = [...users];
  rows.sort((left, right) => {
    if (mode === "created_desc") {
      const createdDiff = toMillis(right.createdAt) - toMillis(left.createdAt);
      if (createdDiff !== 0) return createdDiff;
    }

    return (left.displayName ?? left.email ?? left.uid).localeCompare(
      right.displayName ?? right.email ?? right.uid,
    );
  });
  return rows;
}

export function getPeopleRoleFilterOptions() {
  return [
    { value: "all", label: "All Roles" },
    { value: "BDA_TRAINEE", label: "BDA (Trainee)" },
    { value: "BDA", label: "BDA" },
    { value: "BDM_TRAINING", label: "BDM (Training)" },
    { value: "TEAM_LEAD", label: "Team Lead" },
    { value: "MANAGER", label: "Manager" },
    { value: "SENIOR_MANAGER", label: "Senior Manager" },
    { value: "GM", label: "GM" },
    { value: "AVP", label: "AVP" },
    { value: "VP", label: "VP" },
    { value: "SALES_HEAD", label: "Sales Head" },
    { value: "CBO", label: "CBO" },
    { value: "CEO", label: "CEO" },
    { value: "HR", label: "HR" },
    { value: "FINANCER", label: "Financer" },
    { value: "EMPLOYEE", label: "Employee" },
    { value: "SUPER_ADMIN", label: "Super Admin" },
    { value: "ADMIN", label: "Admin" },
  ];
}

export function buildPeopleDirectoryStats(users: UserDoc[]): PeopleDirectoryStats {
  return {
    totalActive: users.filter((user) => (user.status ?? "inactive").toLowerCase() === "active").length,
    leadership: users.filter((user) => getSalesHierarchyRank(user) >= getSalesHierarchyRank("MANAGER") && (user.status ?? "inactive").toLowerCase() === "active").length,
    teamLeads: users.filter((user) => normalizeRoleValue(user.orgRole ?? user.role) === "TEAM_LEAD" && (user.status ?? "inactive").toLowerCase() === "active").length,
    hr: users.filter((user) => normalizeRoleValue(user.orgRole ?? user.role) === "HR" && (user.status ?? "inactive").toLowerCase() === "active").length,
    finance: users.filter((user) => normalizeRoleValue(user.orgRole ?? user.role) === "FINANCER" && (user.status ?? "inactive").toLowerCase() === "active").length,
  };
}

export function filterPeopleDirectoryUsers(users: UserDoc[], filters: PeopleDirectoryFilters) {
  const normalizedSearch = filters.searchTerm.trim().toLowerCase();
  return users.filter((user) => {
    const matchesSearch =
      normalizedSearch.length === 0 ||
      (user.displayName ?? "").toLowerCase().includes(normalizedSearch) ||
      (user.email ?? "").toLowerCase().includes(normalizedSearch) ||
      (user.employeeId ?? "").toLowerCase().includes(normalizedSearch);

    const normalizedRole = normalizeRoleValue(user.orgRole ?? user.role);
    const matchesRole = filters.roleFilter === "all" || normalizedRole === filters.roleFilter;
    const matchesStatus =
      filters.statusFilter === "all" ||
      (user.status ?? "inactive").toLowerCase() === filters.statusFilter.toLowerCase();

    return matchesSearch && matchesRole && matchesStatus;
  });
}

export function paginatePeopleDirectoryUsers(users: UserDoc[], currentPage: number, itemsPerPage: number) {
  const start = (currentPage - 1) * itemsPerPage;
  return users.slice(start, start + itemsPerPage);
}

function buildSupervisorUsers(users: UserDoc[]) {
  const unique = new Map<string, UserDoc>();
  const hrMap = new Map<string, UserDoc>();

  users.forEach((user) => {
    const normalized = normalizeRoleValue(user.orgRole ?? user.role);
    const isExecutiveControl = EXECUTIVE_CONTROL_ROLES.has(normalized);

    if (isExecutiveControl || canReadSalesScope(user)) {
      unique.set(user.uid, user);
    }

    if (normalized === "HR" || isExecutiveControl) {
      hrMap.set(user.uid, user);
    }
  });

  const supervisors = sortUsersByHierarchy(Array.from(unique.values())).sort((left, right) => {
    const leftIsExecutive = EXECUTIVE_CONTROL_ROLES.has(normalizeRoleValue(left.orgRole ?? left.role));
    const rightIsExecutive = EXECUTIVE_CONTROL_ROLES.has(normalizeRoleValue(right.orgRole ?? right.role));

    if (leftIsExecutive !== rightIsExecutive) {
      return rightIsExecutive ? 1 : -1;
    }

    const rankDiff = getSalesHierarchyRank(right) - getSalesHierarchyRank(left);
    if (rankDiff !== 0) return rankDiff;

    return (left.displayName ?? left.email ?? left.uid).localeCompare(
      right.displayName ?? right.email ?? right.uid,
    );
  });

  return {
    supervisors,
    hrUsers: Array.from(hrMap.values()).sort((left, right) =>
      (left.displayName ?? left.email ?? left.uid).localeCompare(
        right.displayName ?? right.email ?? right.uid,
      ),
    ),
  };
}

export function usePeopleDirectoryData({
  includeExecutiveControl = true,
  sortMode = "display_name",
  refreshKey = null,
}: UsePeopleDirectoryOptions = {}): UsePeopleDirectoryResult {
  const [result, setResult] = useState<UsePeopleDirectoryResult>({
    allUsers: [],
    visibleUsers: [],
    supervisors: [],
    hrUsers: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!db || !isFirebaseReady) {
      setResult({
        allUsers: [],
        visibleUsers: [],
        supervisors: [],
        hrUsers: [],
        loading: false,
        error: new Error("Firebase is not configured"),
      });
      return;
    }

    const firestore = db;
    const usersQuery = query(collection(firestore, "users"));

    return onSnapshot(
      usersQuery,
      (snapshot) => {
        const allUsers = snapshot.docs.map((row) => ({ ...(row.data() as UserDoc), uid: row.id }));
        const visibleUsers = sortPeopleDirectoryUsers(
          allUsers.filter((user) => {
            if (includeExecutiveControl) return true;
            return !EXECUTIVE_CONTROL_ROLES.has(normalizeRoleValue(user.orgRole ?? user.role));
          }),
          sortMode,
        );
        const { supervisors, hrUsers } = buildSupervisorUsers(allUsers);
        setResult({
          allUsers: sortPeopleDirectoryUsers(allUsers, sortMode),
          visibleUsers,
          supervisors,
          hrUsers,
          loading: false,
          error: null,
        });
      },
      (error) => {
        setResult({
          allUsers: [],
          visibleUsers: [],
          supervisors: [],
          hrUsers: [],
          loading: false,
          error: error instanceof Error ? error : new Error("Unable to load directory"),
        });
      },
    );
  }, [includeExecutiveControl, refreshKey, sortMode]);

  return result;
}

export function usePeopleDirectoryView(
  users: UserDoc[],
  filters: PeopleDirectoryFilters,
  currentPage: number,
  itemsPerPage: number,
) {
  return useMemo(() => {
    const filteredUsers = filterPeopleDirectoryUsers(users, filters);
    const paginatedUsers = paginatePeopleDirectoryUsers(filteredUsers, currentPage, itemsPerPage);
    const stats = buildPeopleDirectoryStats(users);

    return {
      filteredUsers,
      paginatedUsers,
      stats,
    };
  }, [currentPage, filters, itemsPerPage, users]);
}
