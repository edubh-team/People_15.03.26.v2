export const CANONICAL_DOMAIN_ROUTES = {
  MY_DAY: "/my-day",
  CRM: "/crm/leads",
  TEAM: "/team",
  HR: "/hr",
  PAYROLL: "/payroll",
  REPORTS: "/reports",
  TRAINING: "/training",
  CHANNEL_PARTNER: "/channel-partner/dashboard",
  KNOWLEDGE_CENTER: "/knowledge-center",
  FINANCE: "/finance",
  SUPER_ADMIN: "/super-admin/mission-control",
  DASHBOARD: "/dashboard",
} as const;

export const LEGACY_ROUTE_BRIDGES: Record<string, string> = {
  "/leads/new": "/crm/leads?surface=new&layout=compact",
  "/leads/previous": "/crm/leads?surface=worked&layout=compact",
  "/super-admin/leads": "/crm/leads?surface=inspector",
  "/team-lead": "/team",
  "/hr/dashboard": "/hr",
};
