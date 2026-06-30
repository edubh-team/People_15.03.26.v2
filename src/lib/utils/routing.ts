import { getRoleLayoutProfile } from "@/lib/layouts/role-layout";
import { CANONICAL_DOMAIN_ROUTES } from "@/lib/routes/canonical";

export const ROUTES = {
  SUPER_ADMIN: CANONICAL_DOMAIN_ROUTES.SUPER_ADMIN,
  MANAGER: CANONICAL_DOMAIN_ROUTES.TEAM,
  TEAM_LEAD: CANONICAL_DOMAIN_ROUTES.TEAM,
  BDA: CANONICAL_DOMAIN_ROUTES.CRM,
  CHANNEL_PARTNER: CANONICAL_DOMAIN_ROUTES.CHANNEL_PARTNER,
  BDA_TRAINEE: CANONICAL_DOMAIN_ROUTES.TRAINING,
  BDM_TRAINING: CANONICAL_DOMAIN_ROUTES.TRAINING,
  EMPLOYEE: CANONICAL_DOMAIN_ROUTES.DASHBOARD,
  HR: CANONICAL_DOMAIN_ROUTES.HR,
  FINANCE: CANONICAL_DOMAIN_ROUTES.FINANCE,
  LOGIN: "/sign-in",
};

export function getHomeRoute(role?: string | null, orgRole?: string | null): string {
  return getRoleLayoutProfile({
    role: role ?? null,
    orgRole: orgRole ?? null,
  }).homeRoute;
}
