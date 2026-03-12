import {
  isAdminUser,
} from "@/lib/access";
import {
  canAssignSalesScope,
  canOwnSalesLeads,
  canReadSalesScope,
  getHierarchyScopedUsers,
  isActiveUser,
  isSalesHierarchyUser,
  sortUsersByHierarchy,
} from "@/lib/sales/hierarchy";
import type { LeadDoc } from "@/lib/types/crm";
import type { UserDoc } from "@/lib/types/user";

export function canAccessCrm(user: UserDoc | null | undefined) {
  return isAdminUser(user) || isSalesHierarchyUser(user);
}

export function canUseCrmInspector(user: UserDoc | null | undefined) {
  return isAdminUser(user) || canReadSalesScope(user);
}

export function canUseGlobalCrmView(user: UserDoc | null | undefined) {
  return isAdminUser(user);
}

export function canEditLeadProfile(user: UserDoc | null | undefined) {
  return isAdminUser(user) || isSalesHierarchyUser(user);
}

export function canReassignLead(user: UserDoc | null | undefined) {
  return isAdminUser(user) || canAssignSalesScope(user);
}

export function canManageLeadAssignment(user: UserDoc | null | undefined) {
  return isAdminUser(user) || canAssignSalesScope(user);
}

export function getAssignableLeadOwners(
  user: UserDoc | null | undefined,
  users: UserDoc[] = [],
) {
  if (!user) return [];

  const pool = users.some((candidate) => candidate.uid === user.uid)
    ? users
    : [user, ...users];

  if (!canManageLeadAssignment(user)) return [];

  return sortUsersByHierarchy(
    pool.filter(
      (candidate) =>
        candidate.uid !== user.uid && isActiveUser(candidate) && canOwnSalesLeads(candidate),
    ),
  );
}

export function getCrmScopeUids(
  user: UserDoc | null | undefined,
  scopedUsers: UserDoc[] = [],
): string[] | null {
  if (!user) return [];
  if (canUseGlobalCrmView(user)) return null;
  if (canUseCrmInspector(user)) {
    return Array.from(new Set([user.uid, ...scopedUsers.map((member) => member.uid)]));
  }
  return [user.uid];
}

export function leadMatchesCrmScope(lead: LeadDoc, allowedUids: string[] | null) {
  if (allowedUids == null) return true;

  const allowed = new Set(allowedUids);
  if (lead.assignedTo && allowed.has(lead.assignedTo)) return true;
  if (lead.ownerUid && allowed.has(lead.ownerUid)) return true;
  if (lead.createdBy?.uid && allowed.has(lead.createdBy.uid)) return true;
  if (lead.closedBy?.uid && allowed.has(lead.closedBy.uid)) return true;
  return false;
}
