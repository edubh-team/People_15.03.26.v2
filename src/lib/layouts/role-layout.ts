import {
  canQualifyBdaTrainee,
  getPrimaryRole,
  hasRole,
  type CanonicalRole,
} from "@/lib/access";
import { CANONICAL_DOMAIN_ROUTES } from "@/lib/routes/canonical";

type RoleSource =
  | {
      role?: string | null;
      orgRole?: string | null;
    }
  | null
  | undefined;

export type AppWorkspace = "CRM" | "HR";

export type AppNavIconName =
  | "home"
  | "dashboard"
  | "attendance"
  | "tasks"
  | "leads"
  | "reports"
  | "admin"
  | "settings"
  | "chat"
  | "users"
  | "recruitment"
  | "money";

export type ShellNavItem = {
  label: string;
  href: string;
  icon: AppNavIconName;
};

export type ShellNavGroup = {
  key: string;
  label: string;
  children: ShellNavItem[];
};

export type CrmCommandSection =
  | "summary"
  | "assignment"
  | "activities"
  | "tasks"
  | "notes"
  | "documents"
  | "status"
  | "audit";

export type CrmWorkbenchAction =
  | "call"
  | "whatsapp"
  | "update"
  | "reassign"
  | "details";

export type RoleLayoutKey =
  | Exclude<CanonicalRole, "UNKNOWN">;

type CrmLayoutProfile = {
  defaultSection: CrmCommandSection;
  visibleSections: CrmCommandSection[];
  workbenchActions: CrmWorkbenchAction[];
  showLeadInspector: boolean;
};

export type RoleLayoutProfile = {
  key: RoleLayoutKey;
  homeRoute: string;
  defaultWorkspace: AppWorkspace;
  availableWorkspaces: AppWorkspace[];
  showTeamModeToggle: boolean;
  showSetup: boolean;
  shellGroups: ShellNavGroup[];
  crm: CrmLayoutProfile;
};

const PERSONAL_GROUP: ShellNavGroup = {
  key: "PERSONAL",
  label: "MY ACCOUNT",
  children: [
    { label: "My Profile", href: "/profile/me", icon: "settings" },
    { label: "Knowledge Center", href: CANONICAL_DOMAIN_ROUTES.KNOWLEDGE_CENTER, icon: "reports" },
    { label: "Messages", href: "/chat", icon: "chat" },
  ],
};

const WORKDAY_GROUP: ShellNavGroup = {
  key: "WORKDAY",
  label: "MY WORKDAY",
  children: [
    { label: "Attendance", href: "/attendance", icon: "attendance" },
    { label: "Tasks", href: "/tasks", icon: "tasks" },
  ],
};

const SALES_BDA_GROUP: ShellNavGroup = {
  key: "SALES",
  label: "SALES EXECUTION",
  children: [{ label: "Leads", href: CANONICAL_DOMAIN_ROUTES.CRM, icon: "leads" }],
};

const CHANNEL_PARTNER_GROUP: ShellNavGroup = {
  key: "CHANNEL",
  label: "CHANNEL PARTNER",
  children: [
    {
      label: "Partner Dashboard",
      href: CANONICAL_DOMAIN_ROUTES.CHANNEL_PARTNER,
      icon: "dashboard",
    },
    { label: "Leads", href: CANONICAL_DOMAIN_ROUTES.CRM, icon: "leads" },
  ],
};

const TRAINING_GROUP: ShellNavGroup = {
  key: "TRAINING",
  label: "TRAINING OPS",
  children: [
    { label: "Training Dashboard", href: CANONICAL_DOMAIN_ROUTES.TRAINING, icon: "dashboard" },
    { label: "Trainee Leads", href: CANONICAL_DOMAIN_ROUTES.CRM, icon: "leads" },
  ],
};

const SALES_LEADERSHIP_GROUP: ShellNavGroup = {
  key: "SALES",
  label: "CRM & REPORTING",
  children: [
    { label: "Leads", href: CANONICAL_DOMAIN_ROUTES.CRM, icon: "leads" },
    { label: "Reports", href: CANONICAL_DOMAIN_ROUTES.REPORTS, icon: "reports" },
  ],
};

const TEAM_LEAD_MANAGEMENT_GROUP: ShellNavGroup = {
  key: "MANAGEMENT",
  label: "TEAM OPERATIONS",
  children: [
    { label: "Team Management", href: CANONICAL_DOMAIN_ROUTES.TEAM, icon: "leads" },
    { label: "Employee Directory", href: "/team/directory", icon: "users" },
    { label: "Leave Approvals", href: "/hr/leaves", icon: "attendance" },
    { label: "Admin Settings", href: "/team/admin", icon: "settings" },
  ],
};

const MANAGER_GROUP: ShellNavGroup = {
  key: "MANAGEMENT",
  label: "TEAM OPERATIONS",
  children: [
    { label: "Team Management", href: CANONICAL_DOMAIN_ROUTES.TEAM, icon: "leads" },
    { label: "Employee Directory", href: "/team/directory", icon: "users" },
    { label: "Leave Approvals", href: "/hr/leaves", icon: "attendance" },
  ],
};

const ADMIN_GROUP: ShellNavGroup = {
  key: "MANAGEMENT",
  label: "SYSTEM OPERATIONS",
  children: [
    { label: "Employee Directory", href: "/team/directory", icon: "users" },
    { label: "Personnel Studio", href: "/super-admin/personnel", icon: "admin" },
    { label: "Admin Settings", href: "/admin", icon: "settings" },
    { label: "System Logs", href: "/admin/logs", icon: "admin" },
  ],
};

const HR_GROUP: ShellNavGroup = {
  key: "HR",
  label: "PEOPLE OPERATIONS",
  children: [
    { label: "People Ops", href: CANONICAL_DOMAIN_ROUTES.HR, icon: "dashboard" },
    { label: "Personnel Studio", href: "/super-admin/personnel", icon: "admin" },
    { label: "Attendance Ops", href: "/hr/attendance", icon: "attendance" },
    { label: "Leave Ops", href: "/hr/leaves", icon: "attendance" },
    { label: "Payroll Ops", href: CANONICAL_DOMAIN_ROUTES.PAYROLL, icon: "money" },
    { label: "Training Dashboard", href: CANONICAL_DOMAIN_ROUTES.TRAINING, icon: "reports" },
    { label: "Recruitment", href: "/hr/recruitment", icon: "recruitment" },
  ],
};

const FINANCE_GROUP: ShellNavGroup = {
  key: "FINANCE",
  label: "FINANCE OPERATIONS",
  children: [
    { label: "Dashboard", href: CANONICAL_DOMAIN_ROUTES.FINANCE, icon: "money" },
    { label: "Accounts Directory", href: "/finance/accounts", icon: "users" },
    { label: "Reports", href: CANONICAL_DOMAIN_ROUTES.REPORTS, icon: "reports" },
  ],
};

const SUPER_GROUP: ShellNavGroup = {
  key: "SUPER",
  label: "EXECUTIVE CONTROL",
  children: [
    { label: "Mission Control", href: CANONICAL_DOMAIN_ROUTES.SUPER_ADMIN, icon: "dashboard" },
    { label: "People Ops", href: CANONICAL_DOMAIN_ROUTES.HR, icon: "users" },
    { label: "Training Dashboard", href: CANONICAL_DOMAIN_ROUTES.TRAINING, icon: "reports" },
    { label: "Payroll Ops", href: CANONICAL_DOMAIN_ROUTES.PAYROLL, icon: "money" },
    { label: "Personnel Studio", href: "/super-admin/personnel", icon: "admin" },
    {
      label: "Operations & Governance",
      href: "/super-admin/operations",
      icon: "admin",
    },
    { label: "Audit", href: "/super-admin/audit", icon: "admin" },
  ],
};

const CRM_AGENT_SECTIONS: CrmCommandSection[] = [
  "summary",
  "assignment",
  "activities",
  "tasks",
  "notes",
  "documents",
  "status",
];

const CRM_LEADERSHIP_SECTIONS: CrmCommandSection[] = [
  "summary",
  "assignment",
  "activities",
  "tasks",
  "notes",
  "documents",
  "status",
];

const CRM_ADMIN_SECTIONS: CrmCommandSection[] = [
  ...CRM_LEADERSHIP_SECTIONS,
  "audit",
];

const DEFAULT_CRM_ACTIONS: CrmWorkbenchAction[] = [
  "call",
  "whatsapp",
  "update",
  "details",
];

function resolveLayoutKey(user: RoleSource): RoleLayoutKey {
  const primaryRole = getPrimaryRole(user);

  switch (primaryRole) {
    case "SUPER_ADMIN":
    case "ADMIN":
    case "HR":
    case "FINANCER":
    case "MANAGER":
    case "SENIOR_MANAGER":
    case "GM":
    case "AVP":
    case "VP":
    case "SALES_HEAD":
    case "CBO":
    case "CEO":
    case "TEAM_LEAD":
    case "EMPLOYEE":
    case "CHANNEL_PARTNER":
    case "BDA_TRAINEE":
    case "BDM_TRAINING":
      return primaryRole === "MANAGER" ||
        primaryRole === "SENIOR_MANAGER" ||
        primaryRole === "GM" ||
        primaryRole === "AVP" ||
        primaryRole === "VP" ||
        primaryRole === "SALES_HEAD" ||
        primaryRole === "CBO" ||
        primaryRole === "CEO"
        ? "MANAGER"
        : primaryRole;
    case "BDA":
      return "BDA";
    default:
      if (hasRole(user, "ADMIN")) return "ADMIN";
      if (
        hasRole(
          user,
          "MANAGER",
          "SENIOR_MANAGER",
          "GM",
          "AVP",
          "VP",
          "SALES_HEAD",
          "CBO",
          "CEO",
        )
      ) {
        return "MANAGER";
      }
      if (hasRole(user, "BDM_TRAINING")) return "BDM_TRAINING";
      if (hasRole(user, "BDA_TRAINEE")) return "BDA_TRAINEE";
      if (hasRole(user, "CHANNEL_PARTNER")) return "CHANNEL_PARTNER";
      if (hasRole(user, "TEAM_LEAD")) return "TEAM_LEAD";
      if (hasRole(user, "FINANCER")) return "FINANCER";
      if (hasRole(user, "HR")) return "HR";
      return "EMPLOYEE";
  }
}

export function getRoleLayoutProfile(user: RoleSource): RoleLayoutProfile {
  const key = resolveLayoutKey(user);

  switch (key) {
    case "SUPER_ADMIN":
      return {
        key,
        homeRoute: CANONICAL_DOMAIN_ROUTES.MY_DAY,
        defaultWorkspace: "CRM",
        availableWorkspaces: ["CRM", "HR"],
        showTeamModeToggle: false,
        showSetup: true,
        shellGroups: [
          SUPER_GROUP,
          FINANCE_GROUP,
          HR_GROUP,
          ADMIN_GROUP,
          SALES_LEADERSHIP_GROUP,
          WORKDAY_GROUP,
          PERSONAL_GROUP,
        ],
        crm: {
          defaultSection: "summary",
          visibleSections: CRM_ADMIN_SECTIONS,
          workbenchActions: [...DEFAULT_CRM_ACTIONS, "reassign"],
          showLeadInspector: true,
        },
      };
    case "ADMIN":
      return {
        key,
        homeRoute: CANONICAL_DOMAIN_ROUTES.MY_DAY,
        defaultWorkspace: "CRM",
        availableWorkspaces: ["CRM"],
        showTeamModeToggle: false,
        showSetup: true,
        shellGroups: [ADMIN_GROUP, SALES_LEADERSHIP_GROUP, WORKDAY_GROUP, PERSONAL_GROUP],
        crm: {
          defaultSection: "summary",
          visibleSections: CRM_ADMIN_SECTIONS,
          workbenchActions: [...DEFAULT_CRM_ACTIONS, "reassign"],
          showLeadInspector: true,
        },
      };
    case "HR":
      return {
        key,
        homeRoute: CANONICAL_DOMAIN_ROUTES.MY_DAY,
        defaultWorkspace: "HR",
        availableWorkspaces: ["HR"],
        showTeamModeToggle: false,
        showSetup: false,
        shellGroups: [HR_GROUP, WORKDAY_GROUP, PERSONAL_GROUP],
        crm: {
          defaultSection: "summary",
          visibleSections: CRM_AGENT_SECTIONS,
          workbenchActions: DEFAULT_CRM_ACTIONS,
          showLeadInspector: false,
        },
      };
    case "FINANCER":
      return {
        key,
        homeRoute: CANONICAL_DOMAIN_ROUTES.MY_DAY,
        defaultWorkspace: "CRM",
        availableWorkspaces: ["CRM"],
        showTeamModeToggle: false,
        showSetup: false,
        shellGroups: [FINANCE_GROUP, WORKDAY_GROUP, PERSONAL_GROUP],
        crm: {
          defaultSection: "summary",
          visibleSections: CRM_AGENT_SECTIONS,
          workbenchActions: DEFAULT_CRM_ACTIONS,
          showLeadInspector: false,
        },
      };
    case "MANAGER":
      return {
        key,
        homeRoute: CANONICAL_DOMAIN_ROUTES.MY_DAY,
        defaultWorkspace: "CRM",
        availableWorkspaces: ["CRM"],
        showTeamModeToggle: false,
        showSetup: false,
        shellGroups: [MANAGER_GROUP, SALES_LEADERSHIP_GROUP, WORKDAY_GROUP, PERSONAL_GROUP],
        crm: {
          defaultSection: "summary",
          visibleSections: CRM_ADMIN_SECTIONS,
          workbenchActions: [...DEFAULT_CRM_ACTIONS, "reassign"],
          showLeadInspector: false,
        },
      };
    case "TEAM_LEAD":
      return {
        key,
        homeRoute: CANONICAL_DOMAIN_ROUTES.MY_DAY,
        defaultWorkspace: "CRM",
        availableWorkspaces: ["CRM"],
        showTeamModeToggle: true,
        showSetup: false,
        shellGroups: [TEAM_LEAD_MANAGEMENT_GROUP, SALES_LEADERSHIP_GROUP, WORKDAY_GROUP, PERSONAL_GROUP],
        crm: {
          defaultSection: "summary",
          visibleSections: CRM_ADMIN_SECTIONS,
          workbenchActions: DEFAULT_CRM_ACTIONS,
          showLeadInspector: false,
        },
      };
    case "BDA":
      return {
        key,
        homeRoute: CANONICAL_DOMAIN_ROUTES.MY_DAY,
        defaultWorkspace: "CRM",
        availableWorkspaces: ["CRM"],
        showTeamModeToggle: false,
        showSetup: false,
        shellGroups: [SALES_BDA_GROUP, WORKDAY_GROUP, PERSONAL_GROUP],
        crm: {
          defaultSection: "status",
          visibleSections: CRM_ADMIN_SECTIONS,
          workbenchActions: DEFAULT_CRM_ACTIONS,
          showLeadInspector: false,
        },
      };
    case "CHANNEL_PARTNER":
      return {
        key,
        homeRoute: CANONICAL_DOMAIN_ROUTES.CHANNEL_PARTNER,
        defaultWorkspace: "CRM",
        availableWorkspaces: ["CRM"],
        showTeamModeToggle: false,
        showSetup: false,
        shellGroups: [CHANNEL_PARTNER_GROUP, WORKDAY_GROUP, PERSONAL_GROUP],
        crm: {
          defaultSection: "status",
          visibleSections: CRM_ADMIN_SECTIONS,
          workbenchActions: DEFAULT_CRM_ACTIONS,
          showLeadInspector: false,
        },
      };
    case "BDA_TRAINEE":
      return {
        key,
        homeRoute: CANONICAL_DOMAIN_ROUTES.TRAINING,
        defaultWorkspace: "CRM",
        availableWorkspaces: ["CRM"],
        showTeamModeToggle: false,
        showSetup: false,
        shellGroups: [TRAINING_GROUP, WORKDAY_GROUP, PERSONAL_GROUP],
        crm: {
          defaultSection: "status",
          visibleSections: CRM_ADMIN_SECTIONS,
          workbenchActions: DEFAULT_CRM_ACTIONS,
          showLeadInspector: false,
        },
      };
    case "BDM_TRAINING":
      return {
        key,
        homeRoute: CANONICAL_DOMAIN_ROUTES.TRAINING,
        defaultWorkspace: "CRM",
        availableWorkspaces: ["CRM"],
        showTeamModeToggle: false,
        showSetup: false,
        shellGroups: [TRAINING_GROUP, WORKDAY_GROUP, PERSONAL_GROUP],
        crm: {
          defaultSection: "summary",
          visibleSections: CRM_ADMIN_SECTIONS,
          workbenchActions: DEFAULT_CRM_ACTIONS,
          showLeadInspector: false,
        },
      };
    case "EMPLOYEE":
    default:
      return {
        key,
        homeRoute: CANONICAL_DOMAIN_ROUTES.MY_DAY,
        defaultWorkspace: "CRM",
        availableWorkspaces: ["CRM"],
        showTeamModeToggle: false,
        showSetup: false,
        shellGroups: [SALES_BDA_GROUP, WORKDAY_GROUP, PERSONAL_GROUP],
        crm: {
          defaultSection: "status",
          visibleSections: CRM_AGENT_SECTIONS,
          workbenchActions: DEFAULT_CRM_ACTIONS,
          showLeadInspector: false,
        },
      };
  }
}

export function getShellNavigationGroups(
  user: RoleSource,
  options: {
    workspace: AppWorkspace;
    pathname?: string | null;
  },
) {
  const profile = getRoleLayoutProfile(user);

  if (profile.key === "TEAM_LEAD") {
    const isTeamMode = options.pathname?.startsWith("/team");
    return isTeamMode
      ? [TEAM_LEAD_MANAGEMENT_GROUP, WORKDAY_GROUP, PERSONAL_GROUP]
      : [SALES_LEADERSHIP_GROUP, WORKDAY_GROUP, PERSONAL_GROUP];
  }

  const resolvedGroups =
    profile.availableWorkspaces.length === 1
      ? [...profile.shellGroups]
      : (() => {
          const priority =
            options.workspace === "HR"
              ? ["SUPER", "HR", "FINANCE", "MANAGEMENT", "SALES", "WORKDAY", "PERSONAL"]
              : ["SUPER", "FINANCE", "MANAGEMENT", "SALES", "WORKDAY", "PERSONAL", "HR"];
          const ranking = new Map(priority.map((key, index) => [key, index]));

          return [...profile.shellGroups].sort(
            (left, right) =>
              (ranking.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
              (ranking.get(right.key) ?? Number.MAX_SAFE_INTEGER),
          );
        })();

  if (canQualifyBdaTrainee(user)) {
    const exists = resolvedGroups.some((group) =>
      group.children.some((child) => child.href === CANONICAL_DOMAIN_ROUTES.TRAINING),
    );
    if (!exists) {
      const preferredGroupIndex = resolvedGroups.findIndex((group) => group.key === "MANAGEMENT");
      const targetIndex = preferredGroupIndex >= 0 ? preferredGroupIndex : 0;
      const targetGroup = resolvedGroups[targetIndex];
      if (targetGroup) {
        resolvedGroups[targetIndex] = {
          ...targetGroup,
          children: [
            ...targetGroup.children,
            {
              label: "Training Dashboard",
              href: CANONICAL_DOMAIN_ROUTES.TRAINING,
              icon: "reports",
            },
          ],
        };
      }
    }
  }

  return resolvedGroups;
}
