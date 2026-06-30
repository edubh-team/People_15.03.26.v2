import type { UserRole } from "@/lib/types/user";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon:
    | "home"
    | "dashboard"
    | "attendance"
    | "tasks"
    | "leads"
    | "reports"
    | "admin"
    | "settings"
    | "users"
    | "recruitment"
    | "money";
  roles?: Array<UserRole | "manager" | "HR">;
};

export const navItems: NavItem[] = [
  { key: "home", label: "Home", href: "/dashboard", icon: "home" },
  { key: "managerDashboard", label: "Manager Dashboard", href: "/manager/dashboard", icon: "dashboard", roles: ["manager"] },
  { key: "hrGovernance", label: "HR Governance", href: "/manager/governance", icon: "admin", roles: ["manager"] },
  { key: "leadDistribution", label: "Lead Distribution", href: "/manager/leads", icon: "leads", roles: ["manager"] },
  
  // HR Routes
  { key: "hrDashboard", label: "People Ops", href: "/hr", icon: "dashboard", roles: ["HR"] },
  { key: "recruitment", label: "Recruitment", href: "/hr/recruitment", icon: "recruitment", roles: ["HR"] },
  { key: "payroll", label: "Payroll Ops", href: "/payroll", icon: "money", roles: ["HR"] },

  { key: "attendance", label: "Attendance", href: "/attendance", icon: "attendance" },
  { key: "tasks", label: "Tasks", href: "/tasks", icon: "tasks" },
  { key: "leads", label: "CRM Leads", href: "/crm/leads", icon: "leads" },
  { key: "teamManagement", label: "Team Management", href: "/team", icon: "dashboard", roles: ["teamLead"] },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    icon: "reports",
    roles: ["admin", "teamLead"],
  },
  {
    key: "adminSettings",
    label: "Admin settings",
    href: "/admin/settings",
    icon: "admin",
    roles: ["admin"],
  },
  {
    key: "systemLogs",
    label: "System Logs",
    href: "/admin/logs",
    icon: "admin",
    roles: ["admin"],
  },
];

export function getNavItemsForRole(role: UserRole | null | undefined) {
  return navItems.filter((i) => !i.roles || (role ? i.roles.includes(role) : false));
}
