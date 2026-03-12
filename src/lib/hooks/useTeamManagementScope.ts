import type { UserDoc } from "@/lib/types/user";
import { useScopedUsers } from "@/lib/hooks/useScopedUsers";

/**
 * Custom hook to fetch users based on hierarchical "Chain of Command" rules.
 *
 * Rules:
 * - SUPER_ADMIN / ADMIN: Sees all active users.
 * - MANAGER: Sees direct reports and their reporting tree.
 * - TEAM_LEAD: Sees direct reports only.
 * - EMPLOYEE: Sees nothing here. Access is restricted upstream.
 */
export function useTeamManagementScope(currentUser: UserDoc | null) {
  const { users, loading } = useScopedUsers(currentUser, {
    includeCurrentUser: false,
    includeInactive: false,
  });

  return {
    scopedUsers: currentUser ? users : [],
    loading: currentUser ? loading : false,
  };
}
