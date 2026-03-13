import type { UserDoc } from "@/lib/types/user";
import { canUserOperate, normalizeUserStatus } from "@/lib/people/lifecycle";

type RoleLike =
  | {
      uid?: string | null;
      role?: string | null;
      orgRole?: string | null;
      reportsTo?: string | null;
      teamLeadId?: string | null;
      managerId?: string | null;
      temporaryReportsTo?: string | null;
      temporaryReportsToUntil?: unknown;
      temporaryReportsToReason?: string | null;
      actingManagerId?: string | null;
      actingRole?: string | null;
      actingOrgRole?: string | null;
      actingRoleUntil?: unknown;
      lifecycleState?: string | null;
      inactiveUntil?: unknown;
      status?: string | null;
      isActive?: boolean | null;
      displayName?: string | null;
      name?: string | null;
      email?: string | null;
    }
  | null
  | undefined;

export const SALES_HIERARCHY_ORDER = [
  "BDA_TRAINEE",
  "BDA",
  "TEAM_LEAD",
  "MANAGER",
  "SENIOR_MANAGER",
  "GM",
  "AVP",
  "VP",
  "SALES_HEAD",
  "CBO",
  "CEO",
] as const;

export type SalesHierarchyRole = (typeof SALES_HIERARCHY_ORDER)[number];

const ROLE_ALIASES: Record<string, SalesHierarchyRole> = {
  BDA_TRAINEE: "BDA_TRAINEE",
  BDAT: "BDA_TRAINEE",
  BDA_TRAINING: "BDA_TRAINEE",
  BDA: "BDA",
  EMPLOYEE: "BDA",
  EXECUTIVE: "BDA",
  COUNSELLOR: "BDA",
  COUNSELOR: "BDA",
  BDM_TRAINING: "TEAM_LEAD",
  BDMTRAINING: "TEAM_LEAD",
  TRAINING_MANAGER: "TEAM_LEAD",
  TRAINING_BDM: "TEAM_LEAD",
  TEAM_LEAD: "TEAM_LEAD",
  TEAMLEAD: "TEAM_LEAD",
  TL: "TEAM_LEAD",
  MANAGER: "MANAGER",
  SENIOR_MANAGER: "SENIOR_MANAGER",
  SENIORMANAGER: "SENIOR_MANAGER",
  SR_MANAGER: "SENIOR_MANAGER",
  SRMANAGER: "SENIOR_MANAGER",
  GM: "GM",
  GENERAL_MANAGER: "GM",
  AVP: "AVP",
  ASSISTANT_VICE_PRESIDENT: "AVP",
  VP: "VP",
  VICE_PRESIDENT: "VP",
  SALES_HEAD: "SALES_HEAD",
  SALESHEAD: "SALES_HEAD",
  HEAD_SALES: "SALES_HEAD",
  CBO: "CBO",
  CEO: "CEO",
};

function normalizeRoleString(value?: string | null) {
  return (value ?? "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

function coerceDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "object") {
    const candidate = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };

    if (typeof candidate.toDate === "function") {
      const parsed = candidate.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const seconds =
      typeof candidate.seconds === "number"
        ? candidate.seconds
        : typeof candidate._seconds === "number"
          ? candidate._seconds
          : null;
    if (seconds != null) {
      const parsed = new Date(seconds * 1000);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
}

function isAssignmentActive(until: unknown, now: Date) {
  const expiresAt = coerceDate(until);
  if (!expiresAt) return true;
  return expiresAt.getTime() >= now.getTime();
}

function getUserLabel(user: Pick<UserDoc, "uid" | "displayName" | "name" | "email">) {
  return user.displayName?.trim() || user.name?.trim() || user.email?.trim() || user.uid;
}

export function normalizeSalesHierarchyRole(value?: string | null): SalesHierarchyRole | null {
  const normalized = normalizeRoleString(value);
  return ROLE_ALIASES[normalized] ?? null;
}

export function getEffectiveRoleSourceValue(user: RoleLike, now = new Date()) {
  if (!user) return null;

  const actingRole =
    user.actingOrgRole?.trim() || user.actingRole?.trim()
      ? user.actingOrgRole ?? user.actingRole ?? null
      : null;
  if (actingRole && isAssignmentActive(user.actingRoleUntil, now)) {
    return actingRole;
  }

  return user.orgRole ?? user.role ?? null;
}

export function getEffectiveSalesHierarchyRole(
  user: RoleLike,
  now = new Date(),
): SalesHierarchyRole | null {
  return normalizeSalesHierarchyRole(getEffectiveRoleSourceValue(user, now));
}

export function getSalesHierarchyRank(
  input: RoleLike | string | null | undefined,
  now = new Date(),
) {
  const role =
    typeof input === "string"
      ? normalizeSalesHierarchyRole(input)
      : getEffectiveSalesHierarchyRole(input, now);
  return role ? SALES_HIERARCHY_ORDER.indexOf(role) : -1;
}

export function isSalesHierarchyUser(user: RoleLike, now = new Date()) {
  return getSalesHierarchyRank(user, now) >= 0;
}

export function isSalesLeadershipUser(user: RoleLike, now = new Date()) {
  return getSalesHierarchyRank(user, now) >= SALES_HIERARCHY_ORDER.indexOf("TEAM_LEAD");
}

export function isManagerLevelSalesUser(user: RoleLike, now = new Date()) {
  return getSalesHierarchyRank(user, now) >= SALES_HIERARCHY_ORDER.indexOf("MANAGER");
}

export function canReadSalesScope(user: RoleLike, now = new Date()) {
  return isSalesLeadershipUser(user, now);
}

export function canAssignSalesScope(user: RoleLike, now = new Date()) {
  return isManagerLevelSalesUser(user, now);
}

export function canPullBackSalesScope(user: RoleLike, now = new Date()) {
  return isManagerLevelSalesUser(user, now);
}

export function canViewSalesReports(user: RoleLike, now = new Date()) {
  return isSalesLeadershipUser(user, now);
}

export function canOwnSalesLeads(user: RoleLike, now = new Date()) {
  return isSalesHierarchyUser(user, now);
}

export function isActiveUser(user: RoleLike) {
  if (!user) return false;
  const normalizedStatus = normalizeUserStatus(user.status);
  if (normalizedStatus === "terminated") return false;
  return canUserOperate({
    status: user.status ?? "inactive",
    isActive: user.isActive,
    lifecycleState: user.lifecycleState ?? null,
    inactiveUntil: user.inactiveUntil ?? null,
  });
}

export function getEffectiveReportsToUid(user: RoleLike, now = new Date()) {
  if (!user) return null;
  if (user.temporaryReportsTo && isAssignmentActive(user.temporaryReportsToUntil, now)) {
    return user.temporaryReportsTo;
  }
  return user.reportsTo ?? user.teamLeadId ?? user.managerId ?? null;
}

export function getHierarchyScopedUsers(
  actor: UserDoc | null | undefined,
  users: UserDoc[] = [],
  options: {
    includeCurrentUser?: boolean;
    now?: Date;
  } = {},
) {
  if (!actor) return [];

  const now = options.now ?? new Date();
  const includeCurrentUser = options.includeCurrentUser ?? false;
  const uniqueUsers = new Map<string, UserDoc>();
  users.forEach((user) => {
    if (user?.uid) uniqueUsers.set(user.uid, user);
  });
  uniqueUsers.set(actor.uid, actor);

  const resolveParentUidInDirectory = (user: UserDoc) => {
    const candidates: string[] = [];

    if (user.temporaryReportsTo && isAssignmentActive(user.temporaryReportsToUntil, now)) {
      candidates.push(user.temporaryReportsTo);
    }
    if (user.reportsTo) candidates.push(user.reportsTo);
    if (user.teamLeadId) candidates.push(user.teamLeadId);
    if (user.managerId) candidates.push(user.managerId);

    // Prefer a parent that exists in the fetched directory to keep the scope graph connected.
    const connectedParent = candidates.find(
      (candidateUid) => candidateUid !== user.uid && uniqueUsers.has(candidateUid),
    );
    if (connectedParent) return connectedParent;

    const fallbackParent = candidates.find((candidateUid) => candidateUid !== user.uid);
    return fallbackParent ?? null;
  };

  const childrenByParent = new Map<string, UserDoc[]>();
  uniqueUsers.forEach((user) => {
    const parentUid = resolveParentUidInDirectory(user);
    if (!parentUid || parentUid === user.uid) return;
    const bucket = childrenByParent.get(parentUid) ?? [];
    bucket.push(user);
    childrenByParent.set(parentUid, bucket);
  });

  const scoped = new Map<string, UserDoc>();
  const queue = [...(childrenByParent.get(actor.uid) ?? [])];
  const visited = new Set<string>([actor.uid]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.uid)) continue;
    visited.add(current.uid);
    scoped.set(current.uid, current);

    const children = childrenByParent.get(current.uid) ?? [];
    children.forEach((child) => {
      if (!visited.has(child.uid)) queue.push(child);
    });
  }

  if (includeCurrentUser) {
    scoped.set(actor.uid, actor);
  }

  return sortUsersByHierarchy(Array.from(scoped.values()), now);
}

export function isUserInHierarchyScope(
  actor: UserDoc | null | undefined,
  targetUid: string | null | undefined,
  users: UserDoc[] = [],
  options: {
    includeCurrentUser?: boolean;
    now?: Date;
  } = {},
) {
  if (!actor || !targetUid) return false;
  return getHierarchyScopedUsers(actor, users, options).some((user) => user.uid === targetUid);
}

export function sortUsersByHierarchy(users: UserDoc[], now = new Date()) {
  return [...users].sort((left, right) => {
    const rankDiff = getSalesHierarchyRank(right, now) - getSalesHierarchyRank(left, now);
    if (rankDiff !== 0) return rankDiff;
    return getUserLabel(left).localeCompare(getUserLabel(right));
  });
}
