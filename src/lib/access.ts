import {
  canAssignSalesScope,
  canPullBackSalesScope,
  canReadSalesScope,
  canViewSalesReports,
  getEffectiveRoleSourceValue,
  getSalesHierarchyRank,
  isManagerLevelSalesUser,
} from "@/lib/sales/hierarchy";

type RoleSource =
  | {
      role?: string | null;
      orgRole?: string | null;
      actingRole?: string | null;
      actingOrgRole?: string | null;
      actingRoleUntil?: unknown;
    }
  | null
  | undefined;

export type CanonicalRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "HR"
  | "FINANCER"
  | "MANAGER"
  | "SENIOR_MANAGER"
  | "GM"
  | "AVP"
  | "VP"
  | "SALES_HEAD"
  | "CBO"
  | "CEO"
  | "TEAM_LEAD"
  | "EMPLOYEE"
  | "BDA"
  | "CHANNEL_PARTNER"
  | "BDA_TRAINEE"
  | "BDM_TRAINING"
  | "UNKNOWN";

export function normalizeRoleValue(value?: string | null): CanonicalRole {
  const normalized = (value ?? "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();

  switch (normalized) {
    case "SUPERADMIN":
    case "SUPER_ADMIN":
      return "SUPER_ADMIN";
    case "ADMIN":
      return "ADMIN";
    case "HR":
      return "HR";
    case "FINANCER":
    case "FINANCE":
      return "FINANCER";
    case "MANAGER":
      return "MANAGER";
    case "SENIOR_MANAGER":
    case "SENIORMANAGER":
    case "SR_MANAGER":
    case "SRMANAGER":
      return "SENIOR_MANAGER";
    case "GM":
    case "GENERAL_MANAGER":
      return "GM";
    case "AVP":
    case "ASSISTANT_VICE_PRESIDENT":
      return "AVP";
    case "VP":
    case "VICE_PRESIDENT":
      return "VP";
    case "SALES_HEAD":
    case "SALESHEAD":
    case "HEAD_SALES":
      return "SALES_HEAD";
    case "CBO":
      return "CBO";
    case "CEO":
      return "CEO";
    case "TEAMLEAD":
    case "TEAM_LEAD":
    case "TL":
      return "TEAM_LEAD";
    case "EMPLOYEE":
      return "EMPLOYEE";
    case "BDA":
      return "BDA";
    case "CHANNEL_PARTNER":
    case "CHANNELPARTNER":
    case "CHANNEL_PARTNERS":
    case "CHANNELPARTNERS":
    case "PARTNER":
    case "CP":
      return "CHANNEL_PARTNER";
    case "BDA_TRAINEE":
    case "BDAT":
    case "BDA_TRAINING":
      return "BDA_TRAINEE";
    case "BDM_TRAINING":
    case "BDMTRAINING":
    case "TRAINING_MANAGER":
    case "TRAINING_BDM":
      return "BDM_TRAINING";
    default:
      return "UNKNOWN";
  }
}

export function hasRole(user: RoleSource, ...roles: CanonicalRole[]) {
  const requested = new Set(roles);
  const primaryRole = getPrimaryRole(user);
  const role = normalizeRoleValue(user?.role);
  const orgRole = normalizeRoleValue(user?.orgRole);

  return requested.has(primaryRole) || requested.has(role) || requested.has(orgRole);
}

export function getPrimaryRole(user: RoleSource): CanonicalRole {
  const effectiveRole = normalizeRoleValue(getEffectiveRoleSourceValue(user));
  if (effectiveRole !== "UNKNOWN") return effectiveRole;

  const orgRole = normalizeRoleValue(user?.orgRole);
  if (orgRole !== "UNKNOWN") return orgRole;
  return normalizeRoleValue(user?.role);
}

export function isSuperAdminUser(user: RoleSource) {
  return hasRole(user, "SUPER_ADMIN");
}

export function isAdminUser(user: RoleSource) {
  return hasRole(user, "SUPER_ADMIN", "ADMIN");
}

export function isFinanceUser(user: RoleSource) {
  return hasRole(user, "FINANCER");
}

export function canAccessFinance(user: RoleSource) {
  return hasRole(user, "SUPER_ADMIN", "FINANCER");
}

export function isHrUser(user: RoleSource) {
  return hasRole(user, "SUPER_ADMIN", "HR");
}

export function isManagerUser(user: RoleSource) {
  return hasRole(
    user,
    "MANAGER",
    "SENIOR_MANAGER",
    "GM",
    "AVP",
    "VP",
    "SALES_HEAD",
    "CBO",
    "CEO",
  );
}

export function isTeamLeadUser(user: RoleSource) {
  return hasRole(user, "TEAM_LEAD");
}

export function canManageTeam(user: RoleSource) {
  return isAdminUser(user) || canReadSalesScope(user);
}

export function canBulkImportLeads(user: RoleSource) {
  return isAdminUser(user) || isManagerLevelSalesUser(user) || hasRole(user, "BDA");
}

export function canCreateUsers(user: RoleSource) {
  return isAdminUser(user) || isManagerLevelSalesUser(user);
}

export function canAssignSalesHierarchy(user: RoleSource) {
  return isAdminUser(user) || canAssignSalesScope(user);
}

export function canPullBackSalesLeads(user: RoleSource) {
  return isAdminUser(user) || canPullBackSalesScope(user);
}

export function canViewSalesHierarchyReports(user: RoleSource) {
  return isAdminUser(user) || isHrUser(user) || canViewSalesReports(user);
}

export function canPunchNewSale(user: RoleSource) {
  // Direct-sale punching is now available to every authenticated role.
  return Boolean(user);
}

export function canQualifyBdaTrainee(user: RoleSource) {
  if (!user) return false;
  if (isAdminUser(user) || isHrUser(user)) return true;
  return (
    getSalesHierarchyRank({
      role: user.role ?? null,
      orgRole: user.orgRole ?? null,
      actingRole: user.actingRole ?? null,
      actingOrgRole: user.actingOrgRole ?? null,
      actingRoleUntil: user.actingRoleUntil ?? null,
    }) >= getSalesHierarchyRank("SENIOR_MANAGER")
  );
}

export function formatRoleLabel(value?: string | null) {
  const normalized = normalizeRoleValue(value);
  switch (normalized) {
    case "SUPER_ADMIN":
      return "Super Admin";
    case "ADMIN":
      return "Admin";
    case "HR":
      return "HR";
    case "FINANCER":
      return "Financer";
    case "MANAGER":
      return "Manager";
    case "SENIOR_MANAGER":
      return "Senior Manager";
    case "GM":
      return "GM";
    case "AVP":
      return "AVP";
    case "VP":
      return "VP";
    case "SALES_HEAD":
      return "Sales Head";
    case "CBO":
      return "CBO";
    case "CEO":
      return "CEO";
    case "TEAM_LEAD":
      return "Team Lead";
    case "EMPLOYEE":
      return "Employee";
    case "BDA":
      return "BDA";
    case "CHANNEL_PARTNER":
      return "Channel Partner";
    case "BDA_TRAINEE":
      return "BDA (Trainee)";
    case "BDM_TRAINING":
      return "BDM (Training)";
    default:
      return (value ?? "Employee")
        .trim()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase()) || "Employee";
  }
}

export function getDisplayRole(user: RoleSource) {
  return formatRoleLabel(user?.orgRole ?? user?.role ?? "Employee");
}
