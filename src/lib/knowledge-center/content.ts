
import type { CanonicalRole } from "@/lib/access";
import { CANONICAL_DOMAIN_ROUTES } from "@/lib/routes/canonical";
import { getRoleLayoutProfile } from "@/lib/layouts/role-layout";

export type GuideRole =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BDA"
  | "BDA_TRAINEE"
  | "BDM_TRAINING"
  | "HR"
  | "FINANCE"
  | "CHANNEL_PARTNER"
  | "EMPLOYEE";

export type GuidedTourStep = {
  id: string;
  title: string;
  description: string;
  route?: string;
};

export type RoleKnowledgeModule = {
  id: string;
  title: string;
  description: string;
  sop: string[];
  route?: string;
};

export type RoleWorkflow = {
  id: string;
  title: string;
  trigger: string;
  outcome: string;
  steps: string[];
  route?: string;
};

export type KnowledgeModuleCatalogItem = {
  id: string;
  title: string;
  group: string;
  summary: string;
  route?: string;
  surface?: "UI" | "LEGACY_UI" | "API" | "AUTOMATION";
  features: string[];
  actions: string[];
  entities: string[];
  permissions?: string[];
  handoffs?: string[];
};

type KnowledgeModuleCatalogSeed = KnowledgeModuleCatalogItem & {
  roles: GuideRole[];
};

export type RoleKnowledgeGuide = {
  role: GuideRole;
  title: string;
  intro: string;
  tourSteps: GuidedTourStep[];
  modules: RoleKnowledgeModule[];
  workflows: RoleWorkflow[];
  moduleCatalog: KnowledgeModuleCatalogItem[];
  operatingRhythm: { daily: string[]; weekly: string[]; biWeekly: string[] };
  shortcuts: Array<{ keys: string; action: string }>;
  alerts: string[];
  troubleshooting: Array<{ issue: string; checks: string[] }>;
  faqs: Array<{ question: string; answer: string }>;
  glossary: Array<{ term: string; meaning: string }>;
};

type RouteModuleHint = Omit<KnowledgeModuleCatalogItem, "id" | "route">;

const ALL_GUIDE_ROLES: GuideRole[] = [
  "SUPER_ADMIN",
  "MANAGER",
  "BDA",
  "BDA_TRAINEE",
  "BDM_TRAINING",
  "HR",
  "FINANCE",
  "CHANNEL_PARTNER",
  "EMPLOYEE",
];

const SALES_GUIDE_ROLES: GuideRole[] = [
  "SUPER_ADMIN",
  "MANAGER",
  "BDA",
  "BDA_TRAINEE",
  "BDM_TRAINING",
  "CHANNEL_PARTNER",
];

const LEADERSHIP_GUIDE_ROLES: GuideRole[] = ["SUPER_ADMIN", "MANAGER"];

const GUIDE_ROLE_SOURCE: Record<GuideRole, { role: string; orgRole: string }> = {
  SUPER_ADMIN: { role: "SUPER_ADMIN", orgRole: "SUPER_ADMIN" },
  MANAGER: { role: "MANAGER", orgRole: "MANAGER" },
  BDA: { role: "BDA", orgRole: "BDA" },
  BDA_TRAINEE: { role: "BDA_TRAINEE", orgRole: "BDA_TRAINEE" },
  BDM_TRAINING: { role: "BDM_TRAINING", orgRole: "BDM_TRAINING" },
  HR: { role: "HR", orgRole: "HR" },
  FINANCE: { role: "FINANCER", orgRole: "FINANCER" },
  CHANNEL_PARTNER: { role: "CHANNEL_PARTNER", orgRole: "CHANNEL_PARTNER" },
  EMPLOYEE: { role: "EMPLOYEE", orgRole: "EMPLOYEE" },
};

const EXTRA_ROLE_ROUTES: Record<GuideRole, string[]> = {
  SUPER_ADMIN: [
    "/dashboard",
    "/employee",
    "/admin",
    "/admin/settings",
    "/admin/employees",
    "/admin/payroll/vault",
    "/admin/logs",
    "/manager/dashboard",
    "/team-lead",
    "/team/admin",
    "/leads/new",
    "/leads/previous",
    "/profile",
    "/profile/[uid]",
    "/reports/[employeeId]",
    "/hr/dashboard",
    "/hr/employees",
    "/hr/payroll",
    "/super-admin/operations",
    "/super-admin/audit",
    "/super-admin/personnel",
    "/super-admin/payroll",
    "/super-admin/leads",
    "/finance/accounts",
    "/hr/recruitment",
    "/team/directory",
    "/api/cron/crm-automation",
    "/api/cron/auto-checkout",
    "/api/integrations/whatsapp/webhook",
    "/api/integrations/whatsapp/pull",
    "/api/team/pipeline-stats",
    "/api/team/unassigned-leads",
    "/api/finance/transaction",
    "/api/finance/approvals",
    "/api/finance/accounts",
    "/api/users/create",
    "/api/setup/promote",
    "/api/session/set",
    "/api/session/clear",
  ],
  MANAGER: [
    "/dashboard",
    "/admin",
    "/admin/employees",
    "/manager/dashboard",
    "/team-lead",
    "/team/admin",
    "/team/directory",
    "/hr/leaves",
    "/hr/employees",
    "/leads/new",
    "/leads/previous",
    "/profile",
    "/reports/[employeeId]",
    "/api/cron/crm-automation",
    "/api/integrations/whatsapp/pull",
    "/api/team/pipeline-stats",
    "/api/team/unassigned-leads",
  ],
  BDA: ["/dashboard", "/employee", "/leads/new", "/leads/previous", "/profile"],
  BDA_TRAINEE: ["/dashboard", "/employee", "/leads/new", "/leads/previous", "/profile"],
  BDM_TRAINING: ["/dashboard", "/employee", "/leads/new", "/leads/previous", "/profile", "/reports/[employeeId]"],
  HR: [
    "/dashboard",
    "/profile",
    "/reports/[employeeId]",
    "/hr/dashboard",
    "/hr/employees",
    "/hr/payroll",
    "/hr/attendance",
    "/hr/leaves",
    "/hr/recruitment",
    "/super-admin/personnel",
    "/api/cron/auto-checkout",
    "/api/users/create",
    "/api/session/set",
    "/api/session/clear",
  ],
  FINANCE: [
    "/dashboard",
    "/profile",
    "/reports/[employeeId]",
    "/finance/accounts",
    "/reports",
    "/payroll",
    "/api/finance/transaction",
    "/api/finance/approvals",
    "/api/finance/accounts",
    "/api/session/set",
    "/api/session/clear",
  ],
  CHANNEL_PARTNER: ["/dashboard", "/employee", "/leads/new", "/leads/previous", "/profile"],
  EMPLOYEE: ["/dashboard", "/employee", "/leads/new", "/leads/previous", "/profile"],
};

const ROUTE_HINTS: Record<string, RouteModuleHint> = {
  [CANONICAL_DOMAIN_ROUTES.MY_DAY]: {
    title: "My Day Dashboards",
    group: "Execution",
    summary: "Action-first role dashboard with alerts and scorecards.",
    features: [
      "Role dashboards (BDA/Manager/HR/Finance/Executive)",
      "Alert rows and exception cards",
      "At-risk and overdue drilldowns",
      "Target and counselling scorecards",
      "PIP and lifecycle status widgets",
      "Attendance and queue snapshots",
    ],
    actions: [
      "Open queue from card",
      "Review alert and open filtered list",
      "Drill into employee/team row",
      "Jump to report scope",
    ],
    entities: ["Scoped leads", "PIP rows", "Counselling rows", "Override queue", "Team KPIs"],
  },
  [CANONICAL_DOMAIN_ROUTES.CRM]: {
    title: "CRM Leads Workbench",
    group: "CRM",
    summary: "Unified queue/cards with smart tabs, filters, and actions.",
    features: [
      "Smart tabs (New, Due, No Activity, Payment, Callbacks, Closures)",
      "Queue and cards layouts",
      "Advanced and smart filters",
      "Local + global search",
      "Batch filter with import tracking",
      "Lead drawer command center",
      "Duplicate review queue surface",
      "Bulk selection entrypoint",
    ],
    actions: [
      "Open top lead",
      "Filter queue by activity/date/status",
      "Run call/WA/log actions",
      "Create/import leads",
      "Apply smart view preset",
      "Open duplicate queue",
    ],
    entities: ["Lead rows", "SLA metadata", "Batch metadata", "Duplicate groups", "Saved views"],
    permissions: ["Read: scoped lead queue", "Write: lead activity/task/status updates", "Assign/Pullback: manager and above"],
    handoffs: ["Lead assignment to owner", "Transfer timeline to managers", "Closure to reporting dashboards"],
  },
  [CANONICAL_DOMAIN_ROUTES.TEAM]: {
    title: "Team Management Cockpit",
    group: "Team Ops",
    summary: "Manager desk for assignment, workload, and bulk controls.",
    features: [
      "Workload heatmap",
      "Queue rescue and stale lead control",
      "Bulk console (explicit and count selection)",
      "Transfer reason templates",
      "Execution logs and failure viewer",
      "Custody-aware assignment controls",
    ],
    actions: ["Assign/reassign", "Pullback before reassign", "Preview bulk diff", "Run bulk action", "Inspect execution logs"],
    entities: ["Scoped leads", "Subordinates", "Bulk logs", "Lead failures", "Transfer timeline"],
    permissions: ["Read/Write: manager+ scoped teams", "Bulk operations: manager and above"],
    handoffs: ["Team assignment handoff", "Bulk transfer to BDA owners", "Failure queue to manager review"],
  },
  ["/team/directory"]: {
    title: "Team Directory",
    group: "Team Ops",
    summary: "Scoped people directory and attendance drilldown.",
    features: ["Directory filters", "Supervisor and role views", "Attendance drilldown modal", "Status and continuity indicators"],
    actions: ["Search people", "Open attendance trail", "Inspect reporting chain"],
    entities: ["Users", "Attendance rows", "Reporting links", "Lifecycle states"],
  },
  ["/tasks"]: {
    title: "Task Workbench",
    group: "Execution",
    summary: "Task queue with buckets, detail drawer, and bulk actions.",
    features: ["Quick filters", "Buckets", "Task priority/state controls", "Bulk task actions", "Linked lead context"],
    actions: ["Create task", "Update status", "Reschedule/complete bulk", "Open linked lead"],
    entities: ["Tasks", "Task comments", "Lead refs", "Assignee metadata"],
  },
  [CANONICAL_DOMAIN_ROUTES.REPORTS]: {
    title: "Hierarchy Reports",
    group: "Reporting",
    summary: "Role-scoped KPI packs, drilldowns, templates, and schedules.",
    features: [
      "Scope mode by hierarchy",
      "Role and date filters",
      "Scheduled exports",
      "Saved templates",
      "KPI to list drilldown",
      "Cross-role views (Sales/HR/Finance)",
    ],
    actions: ["Set scope", "Save template", "Manage schedules", "Open report drilldown", "Export current slice"],
    entities: ["Templates", "Schedules", "KPI rows", "Drilldown payloads"],
  },
  ["/attendance"]: {
    title: "Attendance and Leave",
    group: "People Ops",
    summary: "Personal attendance, break, leave apply, and history.",
    features: ["Check-in/out", "Break controls", "Leave apply", "Leave status timeline", "Month history calendar"],
    actions: ["Mark attendance", "Apply leave", "Track leave status", "Review attendance history"],
    entities: ["Presence", "Leave requests", "Leave balance", "Shift-day rows"],
  },
  [CANONICAL_DOMAIN_ROUTES.HR]: {
    title: "HR People Ops Hub",
    group: "People Ops",
    summary: "Canonical HR entrypoint with people/payroll snapshots.",
    features: ["HR cards", "Queue previews", "Deep links"],
    actions: ["Open attendance ops", "Open leave ops", "Open recruitment"],
    entities: ["HR snapshots", "Leave queue rows"],
  },
  ["/hr/attendance"]: {
    title: "Attendance Oversight",
    group: "People Ops",
    summary: "Override and review flow with immutable audit.",
    features: ["Mark absent override", "HR correction review", "Immutable audit trail", "Payroll-impact status resolution"],
    actions: ["Submit correction", "Approve/reject correction", "Inspect override history"],
    entities: ["Attendance rows", "Override audit rows", "Correction decisions"],
    permissions: ["Override: manager and above", "Approve/reject: HR/admin"],
    handoffs: ["Attendance correction to payroll view", "Override decisions to audit"],
  },
  ["/hr/leaves"]: {
    title: "Leave Authority Queue",
    group: "People Ops",
    summary: "Pending/approved/rejected leave pipeline.",
    features: ["Status tabs", "Scoped approval queue", "Manager stage + HR stage visibility"],
    actions: ["Review leave", "Approve/reject", "Inspect leave reasoning"],
    entities: ["Leave requests", "Leave decision state", "Approval timeline"],
  },
  ["/super-admin/personnel"]: {
    title: "Personnel Studio",
    group: "People Ops",
    summary: "Role/reporting controls plus lifecycle actions.",
    features: ["Temporary/permanent reporting", "Acting role", "Lifecycle actions", "Role promotion/qualification", "Hierarchy mapping"],
    actions: ["Apply role/reporting", "Deactivate/inactive/terminate", "Assign HR supervisor", "Promote trainee to BDA"],
    entities: ["Users", "Lifecycle state", "Transfer continuity", "Reporting overrides", "Acting-role windows"],
    permissions: ["Role/reporting change: HR/admin scoped", "Lifecycle control: manager+ and HR based on scope"],
    handoffs: ["Lifecycle actions to CRM transfer engine", "Role updates to layout/access controls"],
  },
  ["/hr/recruitment"]: {
    title: "Recruitment Pipeline",
    group: "People Ops",
    summary: "Candidate stage board for add/move/hire flow.",
    features: ["Candidate board", "Add candidate", "Hire action"],
    actions: ["Create candidate", "Move stage", "Hire"],
    entities: ["Candidates"],
  },
  [CANONICAL_DOMAIN_ROUTES.TRAINING]: {
    title: "Training Dashboard",
    group: "Training",
    summary: "Trainee qualification tracking and conversion actions.",
    features: ["15-day qualification window", "At-risk flags", "Qualification action", "Training cohort summaries", "Conversion checkpoints"],
    actions: ["Track trainee", "Qualify trainee", "Review deadline risk"],
    entities: ["Trainee users", "Qualification actions", "Training window status"],
  },
  [CANONICAL_DOMAIN_ROUTES.CHANNEL_PARTNER]: {
    title: "Channel Partner Dashboard",
    group: "Channel Partner",
    summary: "Partner sales and commission visibility.",
    features: ["Sales count", "Commission metrics", "Partner queue status", "Trend cards"],
    actions: ["Review payout state", "Open mapped leads", "Track conversion performance"],
    entities: ["Partner leads", "Commission config", "Sales rows"],
  },
  [CANONICAL_DOMAIN_ROUTES.FINANCE]: {
    title: "Finance Dashboard",
    group: "Finance Ops",
    summary: "Ledger, daily/monthly view, payroll tab, and controls.",
    features: ["Ledger", "Daily/monthly summaries", "Approvals tab", "Category controls", "Proof attachment flow"],
    actions: ["Add entry", "Filter ledger", "Switch finance view", "Approve/reject transactions"],
    entities: ["Transactions", "Finance stats", "Daily records", "Approval rows"],
    permissions: ["Read/Write: finance and super-admin", "Approval controls: finance maker-checker scopes"],
    handoffs: ["Finance approvals to reports/payroll exports"],
  },
  ["/finance/accounts"]: {
    title: "Finance Accounts Directory",
    group: "Finance Ops",
    summary: "Beneficiary directory with add/search/filter controls.",
    features: ["Directory filters", "Add person", "Masked details"],
    actions: ["Search beneficiary", "Add beneficiary"],
    entities: ["Account rows"],
  },
  [CANONICAL_DOMAIN_ROUTES.PAYROLL]: {
    title: "Payroll Ops",
    group: "Finance Ops",
    summary: "Payroll view integrated with attendance and incentive context.",
    features: ["Payroll rows", "Deduction inputs", "Payout readiness", "Attendance-linked adjustments", "Counselling incentive context"],
    actions: ["Review payroll", "Validate payout inputs", "Export finance payload"],
    entities: ["Payroll rows", "Leave impact", "Incentive rows"],
  },
  [CANONICAL_DOMAIN_ROUTES.SUPER_ADMIN]: {
    title: "Mission Control",
    group: "Governance",
    summary: "Executive operational command surface.",
    features: ["Executive cards", "Exception visibility", "Cross-module summaries", "Escalation watchlist"],
    actions: ["Review critical signals", "Open deep governance pages", "Launch incident drilldown"],
    entities: ["Ops snapshots", "Escalation rows"],
  },
  ["/super-admin/operations"]: {
    title: "Operations and Governance",
    group: "Governance",
    summary: "Governance and control workspace.",
    features: ["Ops governance panels"],
    actions: ["Review governance actions"],
    entities: ["Governance artifacts"],
  },
  ["/super-admin/audit"]: {
    title: "Audit Workspace",
    group: "Governance",
    summary: "Audit review for high-impact actions.",
    features: ["Audit logs", "Traceability checks"],
    actions: ["Inspect audit rows"],
    entities: ["Audit records"],
  },
  ["/admin"]: {
    title: "Admin Controls",
    group: "Governance",
    summary: "Admin settings and control surfaces.",
    features: ["Admin setup", "System operations tools", "User control links", "Payroll vault handoff"],
    actions: ["Open admin controls", "Open employee controls", "Open settings/logs"],
    entities: ["Admin config", "Admin state"],
  },
  ["/admin/logs"]: {
    title: "System Logs",
    group: "Governance",
    summary: "System logs for debugging and incident review.",
    features: ["Operational logs"],
    actions: ["Inspect logs"],
    entities: ["System logs"],
  },
  ["/chat"]: {
    title: "Messages",
    group: "Collaboration",
    summary: "Internal communication channel.",
    features: ["Role-scoped messaging", "Direct thread interactions", "Cross-team coordination"],
    actions: ["Open thread", "Coordinate handoff", "Send quick updates"],
    entities: ["Message threads", "Participants"],
  },
  ["/profile/me"]: {
    title: "My Profile",
    group: "Personal",
    summary: "Profile and session controls including tour replay.",
    features: ["Profile details", "Tour replay", "Personal settings", "Role and reporting snapshot"],
    actions: ["Update profile", "Start guided tour", "Verify role metadata"],
    entities: ["User profile", "Tour state", "Role metadata"],
  },
  ["/profile"]: {
    title: "Profile Landing",
    group: "Personal",
    summary: "Profile landing surface used by shared navigation links.",
    surface: "LEGACY_UI",
    features: ["Profile wrapper", "Deep-profile redirect behavior"],
    actions: ["Open own profile"],
    entities: ["Current user profile"],
  },
  ["/profile/[uid]"]: {
    title: "Employee Profile Dossier",
    group: "People Ops",
    summary: "Detailed employee dossier for manager/admin investigations.",
    surface: "LEGACY_UI",
    features: ["Employee timeline", "Compensation and role details", "Attendance and leave references"],
    actions: ["Open employee dossier", "Review employment history"],
    entities: ["Employee profile", "Employment history", "Dossier sections"],
  },
  ["/dashboard"]: {
    title: "Legacy Dashboard",
    group: "Legacy Views",
    summary: "Legacy role dashboard retained for continuity while My Day is primary.",
    surface: "LEGACY_UI",
    features: ["Older KPI widgets", "Legacy quick links"],
    actions: ["Open legacy cards", "Navigate to modern surfaces"],
    entities: ["Legacy KPI rows"],
  },
  ["/employee"]: {
    title: "Legacy Employee Home",
    group: "Legacy Views",
    summary: "Legacy employee home used by older role routes.",
    surface: "LEGACY_UI",
    features: ["Legacy home cards", "Old quick action links"],
    actions: ["Open legacy employee view"],
    entities: ["Legacy employee dashboard data"],
  },
  ["/manager/dashboard"]: {
    title: "Manager Dashboard (Legacy)",
    group: "Legacy Views",
    summary: "Legacy manager dashboard with team cards and university modal.",
    surface: "LEGACY_UI",
    features: ["Team cards", "University leads modal", "Manager summary widgets"],
    actions: ["Inspect legacy manager insights"],
    entities: ["Manager KPI rows", "University slices"],
  },
  ["/team-lead"]: {
    title: "Team Lead Legacy Entry",
    group: "Legacy Views",
    summary: "Legacy team-lead entrypoint bridged to modern team operations.",
    surface: "LEGACY_UI",
    features: ["Legacy team controls", "Bridge links to team cockpit"],
    actions: ["Open team lead mode"],
    entities: ["Legacy team rows"],
  },
  ["/team/admin"]: {
    title: "Team Admin Controls",
    group: "Team Ops",
    summary: "Team lead/admin panel for scoped controls and staffing actions.",
    surface: "LEGACY_UI",
    features: ["Scoped admin actions", "Team control panels", "Transfer helper actions"],
    actions: ["Run scoped admin action", "Apply staffing control"],
    entities: ["Team admin config", "Scoped users"],
  },
  ["/reports/[employeeId]"]: {
    title: "Employee Drilldown Report",
    group: "Reporting",
    summary: "Drilldown report for individual employee performance and trends.",
    surface: "LEGACY_UI",
    features: ["Per-employee KPI slices", "Timeline charts", "Performance trends"],
    actions: ["Inspect employee KPI detail", "Export employee view"],
    entities: ["Employee KPI rows", "Drilldown metrics"],
  },
  ["/hr/dashboard"]: {
    title: "HR Dashboard (Legacy)",
    group: "People Ops",
    summary: "Legacy HR dashboard retained with high-level HR cards.",
    surface: "LEGACY_UI",
    features: ["Legacy HR cards", "People ops snapshots"],
    actions: ["Open legacy HR snapshot"],
    entities: ["HR summary metrics"],
  },
  ["/hr/employees"]: {
    title: "HR Employees",
    group: "People Ops",
    summary: "Employee master view for HR/manager/admin reviews.",
    surface: "LEGACY_UI",
    features: ["Employee filters", "Lifecycle indicators", "Compensation context"],
    actions: ["Search employees", "Inspect lifecycle and role data"],
    entities: ["Employee records", "Lifecycle rows"],
  },
  ["/hr/payroll"]: {
    title: "HR Payroll Surface",
    group: "People Ops",
    summary: "HR payroll page retained for compatibility with payroll consolidation.",
    surface: "LEGACY_UI",
    features: ["Payroll records", "Attendance-linked view"],
    actions: ["Review payroll slice"],
    entities: ["Payroll records"],
  },
  ["/super-admin/payroll"]: {
    title: "Super Admin Payroll",
    group: "Governance",
    summary: "Executive payroll controls and audits.",
    surface: "LEGACY_UI",
    features: ["Executive payroll grid", "Approval overrides", "Audit references"],
    actions: ["Review payroll governance", "Inspect payroll anomalies"],
    entities: ["Payroll governance rows"],
  },
  ["/super-admin/leads"]: {
    title: "Lead Inspector (Legacy Route)",
    group: "CRM",
    summary: "Legacy inspector route for deep lead inspection and revenue slices.",
    surface: "LEGACY_UI",
    features: ["Inspector list", "Revenue mode", "Admin-level search"],
    actions: ["Inspect lead", "Switch inspector mode"],
    entities: ["Inspector lead rows", "Revenue lead slices"],
  },
  ["/admin/settings"]: {
    title: "Admin Settings",
    group: "Governance",
    summary: "Admin settings page for platform controls and configuration.",
    surface: "LEGACY_UI",
    features: ["System settings", "Access toggles", "Configuration panels"],
    actions: ["Update system settings", "Adjust admin controls"],
    entities: ["Settings records"],
  },
  ["/admin/employees"]: {
    title: "Admin Employee Console",
    group: "Governance",
    summary: "Admin/manager employee management panel.",
    surface: "LEGACY_UI",
    features: ["Employee listing", "Role controls", "Manager/team lead workflows"],
    actions: ["Manage employee records", "Adjust role and reporting"],
    entities: ["Employee rows", "Role assignments"],
  },
  ["/admin/payroll/vault"]: {
    title: "Payroll Vault",
    group: "Governance",
    summary: "High-security payroll vault for super-admin only actions.",
    surface: "LEGACY_UI",
    features: ["Vault ledger", "Secure status controls", "High-sensitivity payroll actions"],
    actions: ["Review secure payroll records", "Apply vault actions"],
    entities: ["Vault payroll rows", "Security state"],
  },
  ["/leads/new"]: {
    title: "New Leads (Legacy)",
    group: "Legacy Views",
    summary: "Legacy new leads page retained as compatibility surface.",
    surface: "LEGACY_UI",
    features: ["Legacy new queue", "Compatibility filters"],
    actions: ["Open legacy new lead list"],
    entities: ["Legacy lead queue"],
  },
  ["/leads/previous"]: {
    title: "Worked Leads (Legacy)",
    group: "Legacy Views",
    summary: "Legacy worked-leads page retained as compatibility surface.",
    surface: "LEGACY_UI",
    features: ["Legacy worked queue", "Previous interactions list"],
    actions: ["Open legacy worked lead list"],
    entities: ["Legacy worked lead rows"],
  },
  ["/api/cron/crm-automation"]: {
    title: "CRM Automation Job API",
    group: "Automation",
    summary: "Scheduled CRM automation for reminders, stale recovery, and follow-up tasks.",
    surface: "AUTOMATION",
    features: ["SLA automation", "Stale-lead recovery jobs", "Workflow task generation"],
    actions: ["Trigger automation job", "Review job results"],
    entities: ["Automation runs", "Workflow tasks", "Escalation rows"],
  },
  ["/api/cron/auto-checkout"]: {
    title: "Auto Checkout Job API",
    group: "Automation",
    summary: "Scheduled attendance auto-checkout and attendance normalization.",
    surface: "AUTOMATION",
    features: ["Auto checkout", "Attendance correction automation"],
    actions: ["Run auto-checkout job", "Inspect attendance job output"],
    entities: ["Attendance job rows", "Auto-checkout decisions"],
  },
  ["/api/integrations/whatsapp/webhook"]: {
    title: "WhatsApp Webhook API",
    group: "Integrations",
    summary: "Inbound WhatsApp webhook to capture lead contact payloads.",
    surface: "API",
    features: ["Webhook intake", "Contact normalization", "Lead upsert trigger"],
    actions: ["Validate webhook payload", "Inspect webhook response"],
    entities: ["Webhook payloads", "Lead source tags"],
  },
  ["/api/integrations/whatsapp/pull"]: {
    title: "WhatsApp Pull API",
    group: "Integrations",
    summary: "Pull endpoint for WhatsApp contact/message import into CRM.",
    surface: "API",
    features: ["Contact pull", "Lead mapping", "Source tagging"],
    actions: ["Run pull mock", "Inspect mapped leads"],
    entities: ["Pulled contacts", "Mapped lead rows"],
  },
  ["/api/team/pipeline-stats"]: {
    title: "Team Pipeline Stats API",
    group: "Team Ops",
    summary: "Team pipeline aggregation endpoint for manager dashboards.",
    surface: "API",
    features: ["Scoped pipeline aggregation", "Summary metric payload"],
    actions: ["Fetch scoped stats"],
    entities: ["Pipeline summaries"],
  },
  ["/api/team/unassigned-leads"]: {
    title: "Unassigned Leads API",
    group: "Team Ops",
    summary: "Endpoint for unassigned lead queue and assignment desk support.",
    surface: "API",
    features: ["Unassigned queue payload", "Assignment desk support data"],
    actions: ["Fetch unassigned leads"],
    entities: ["Unassigned lead rows"],
  },
  ["/api/finance/transaction"]: {
    title: "Finance Transaction API",
    group: "Finance Ops",
    summary: "Create/update finance ledger transactions with category and proof support.",
    surface: "API",
    features: ["Transaction create/update", "Category validation", "Proof metadata"],
    actions: ["Submit transaction payload"],
    entities: ["Transaction rows", "Category metadata"],
  },
  ["/api/finance/approvals"]: {
    title: "Finance Approval API",
    group: "Finance Ops",
    summary: "Approval workflow endpoint for maker-checker finance operations.",
    surface: "API",
    features: ["Approval state transitions", "Approval remarks handling"],
    actions: ["Approve/reject transaction"],
    entities: ["Approval rows", "Decision logs"],
  },
  ["/api/finance/accounts"]: {
    title: "Finance Accounts API",
    group: "Finance Ops",
    summary: "Beneficiary/account directory endpoint for finance operations.",
    surface: "API",
    features: ["Account lookup", "Beneficiary create/update"],
    actions: ["Fetch accounts", "Create beneficiary"],
    entities: ["Beneficiary rows"],
  },
  ["/api/users/create"]: {
    title: "User Provisioning API",
    group: "People Ops",
    summary: "Employee onboarding endpoint for creating user profiles and credentials.",
    surface: "API",
    features: ["User creation", "Profile bootstrap", "Role bootstrap"],
    actions: ["Provision user account"],
    entities: ["User docs", "Onboarding payload"],
  },
  ["/api/setup/promote"]: {
    title: "Setup Promote API",
    group: "Governance",
    summary: "Administrative setup endpoint for privileged promotion/bootstrap tasks.",
    surface: "API",
    features: ["Privilege bootstrap", "Setup promotion flows"],
    actions: ["Run setup promotion"],
    entities: ["Promotion audit rows"],
  },
  ["/api/session/set"]: {
    title: "Session Set API",
    group: "Security",
    summary: "Session-cookie set endpoint used in authenticated login flow.",
    surface: "API",
    features: ["Session cookie issuance", "Session metadata control"],
    actions: ["Set authenticated session"],
    entities: ["Session token"],
  },
  ["/api/session/clear"]: {
    title: "Session Clear API",
    group: "Security",
    summary: "Session clear endpoint used for sign-out and auth cleanup.",
    surface: "API",
    features: ["Session cookie cleanup", "Logout session invalidation"],
    actions: ["Clear authenticated session"],
    entities: ["Session token"],
  },
  [CANONICAL_DOMAIN_ROUTES.KNOWLEDGE_CENTER]: {
    title: "Knowledge Center",
    group: "Enablement",
    summary: "Role-scoped documentation and onboarding.",
    features: ["Guided tour", "Module manuals", "Role SOP workflows", "Troubleshooting and glossary"],
    actions: ["Start tour", "Search docs", "Open module from manual"],
    entities: ["Guide content", "Module catalog", "Role workflows"],
  },
};

const ALWAYS_MODULES: Array<KnowledgeModuleCatalogItem & { roles: GuideRole[] }> = [
  {
    id: "always-lead-command-center",
    title: "Lead Command Center Deep Functions",
    group: "CRM",
    route: CANONICAL_DOMAIN_ROUTES.CRM,
    summary: "Lead drawer tabs, structured activity types, and audit timeline.",
    surface: "UI",
    features: ["Summary/Assignment/Activities/Tasks/Notes/Documents/Status/Audit", "WA/email template logging"],
    actions: ["Log activity", "Create linked task", "Update status"],
    entities: ["Lead timeline", "Lead activities", "Lead-linked tasks"],
    permissions: ["Read/Write lead detail: scoped CRM users", "Assignment controls: manager and above"],
    handoffs: ["Activity logs to reporting", "Status transitions to automation"],
    roles: SALES_GUIDE_ROLES,
  },
  {
    id: "always-custody-transfer",
    title: "Custody Timeline and Transfer Engine",
    group: "CRM",
    route: CANONICAL_DOMAIN_ROUTES.CRM,
    summary: "Reason-based transfer flow with timeline query and continuity checks.",
    surface: "UI",
    features: ["Mandatory transfer reason", "Queryable transfer history", "Task carry-over"],
    actions: ["Pullback/reassign", "Review transfer history"],
    entities: ["Custody state", "Transfer records"],
    permissions: ["Transfer actions: manager and above"],
    handoffs: ["Custody changes to owner queue", "Transfer records to audit/reporting"],
    roles: LEADERSHIP_GUIDE_ROLES,
  },
  {
    id: "always-duplicate-merge",
    title: "Duplicate Queue and Merge Console",
    group: "CRM",
    route: CANONICAL_DOMAIN_ROUTES.CRM,
    summary: "Duplicate group review with survivor strategy and conflict preview.",
    surface: "UI",
    features: ["Duplicate groups", "Conflict preview", "Survivor strategies"],
    actions: ["Review duplicate", "Merge duplicate"],
    entities: ["Duplicate metadata", "Merge events"],
    permissions: ["Duplicate merge: leadership scopes"],
    handoffs: ["Merge events to audit", "Survivor lead back to active queue"],
    roles: LEADERSHIP_GUIDE_ROLES,
  },
  {
    id: "always-bulk-console-v2",
    title: "Bulk Console v2",
    group: "Team Ops",
    route: CANONICAL_DOMAIN_ROUTES.TEAM,
    summary: "Explicit selection + count selection + preview diff + execution logs.",
    surface: "UI",
    features: ["Selection modes", "Preview diff", "Bulk run logs"],
    actions: ["Prepare run", "Apply run", "Inspect failures"],
    entities: ["crm_bulk_actions", "lead_failures", "lead_changes"],
    permissions: ["Bulk run: manager and above"],
    handoffs: ["Bulk execution to assignment queues", "Failure logs to team remediation"],
    roles: LEADERSHIP_GUIDE_ROLES,
  },
];

function toCatalogIdFromRoute(route: string) {
  return `route-${route.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase()}`;
}

function toTitleCaseFromRoute(route: string) {
  const clean = route
    .replace(/^\//, "")
    .replace(/\[(.+?)\]/g, "$1")
    .replace(/[-_/]+/g, " ")
    .trim();
  if (!clean) return "Root Module";
  return clean
    .split(/\s+/)
    .map((token) => (token.length <= 3 ? token.toUpperCase() : token[0].toUpperCase() + token.slice(1)))
    .join(" ");
}

function fallbackHintForRoute(route: string): RouteModuleHint {
  const isApi = route.startsWith("/api/");
  const surface: KnowledgeModuleCatalogItem["surface"] = isApi ? "API" : "LEGACY_UI";
  const group = isApi ? "Integrations" : "Legacy Views";
  return {
    title: toTitleCaseFromRoute(route),
    group,
    summary: isApi
      ? "System endpoint documented for completeness in role-scoped technical knowledge."
      : "Legacy/auxiliary surface documented for completeness in role-scoped knowledge center.",
    surface,
    features: ["Documented module surface", "Role-scoped visibility"],
    actions: ["Open module", "Review integration/legacy behavior"],
    entities: [isApi ? "API payloads" : "Legacy UI data"],
  };
}

function collectRoleRoutes(role: GuideRole) {
  const layout = getRoleLayoutProfile(GUIDE_ROLE_SOURCE[role]);
  const routes = new Set<string>([layout.homeRoute, CANONICAL_DOMAIN_ROUTES.KNOWLEDGE_CENTER]);
  layout.shellGroups.forEach((group) => group.children.forEach((item) => routes.add(item.href)));
  EXTRA_ROLE_ROUTES[role].forEach((route) => routes.add(route));
  return Array.from(routes);
}

function moduleCatalogForRole(role: GuideRole): KnowledgeModuleCatalogItem[] {
  const rows: KnowledgeModuleCatalogItem[] = [];
  const seen = new Set<string>();

  ALWAYS_MODULES.forEach((row) => {
    if (!row.roles.includes(role)) return;
    seen.add(row.id);
    rows.push({
      id: row.id,
      title: row.title,
      group: row.group,
      summary: row.summary,
      route: row.route,
      surface: row.surface,
      features: [...row.features],
      actions: [...row.actions],
      entities: [...row.entities],
      permissions: row.permissions ? [...row.permissions] : undefined,
      handoffs: row.handoffs ? [...row.handoffs] : undefined,
    });
  });

  collectRoleRoutes(role).forEach((route) => {
    const hint = ROUTE_HINTS[route] ?? fallbackHintForRoute(route);
    const id = toCatalogIdFromRoute(route);
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({
      id,
      route,
      ...hint,
      features: [...hint.features],
      actions: [...hint.actions],
      entities: [...hint.entities],
      permissions: hint.permissions ? [...hint.permissions] : undefined,
      handoffs: hint.handoffs ? [...hint.handoffs] : undefined,
    });
  });

  return rows.sort((a, b) => {
    const groupCompare = a.group.localeCompare(b.group);
    if (groupCompare !== 0) return groupCompare;
    return a.title.localeCompare(b.title);
  });
}

const GLOSSARY = [
  { term: "SLA", meaning: "Follow-up deadline window and escalation threshold." },
  { term: "Custody state", meaning: "Lead ownership state: owned, pulled_back, pooled, reassigned, locked." },
  { term: "Transfer timeline", meaning: "Ownership history with reason, actor, and timestamp." },
  { term: "Bi-weekly cycle", meaning: "14-day cycle for target and scorecard tracking." },
  { term: "PIP", meaning: "Performance Improvement Plan triggered by cycle-compliance logic." },
  { term: "Smart View", meaning: "Saved queue configuration with fixed filters and tab context." },
];

function baseGuide(role: GuideRole, title: string, intro: string): RoleKnowledgeGuide {
  return {
    role,
    title,
    intro,
    tourSteps: [],
    modules: [],
    workflows: [],
    moduleCatalog: moduleCatalogForRole(role),
    operatingRhythm: { daily: [], weekly: [], biWeekly: [] },
    shortcuts: [{ keys: "Ctrl/Cmd + K", action: "Open global command/search." }],
    alerts: [],
    troubleshooting: [],
    faqs: [],
    glossary: [...GLOSSARY],
  };
}

const BDA_GUIDE: RoleKnowledgeGuide = {
  ...baseGuide("BDA", "BDA Knowledge Center", "Complete BDA playbook for CRM execution and daily workflow discipline."),
  tourSteps: [
    { id: "bda-1", title: "My Day", description: "Start from actionable queues.", route: CANONICAL_DOMAIN_ROUTES.MY_DAY },
    { id: "bda-2", title: "CRM", description: "Use queue mode and smart filters.", route: CANONICAL_DOMAIN_ROUTES.CRM },
  ],
  modules: [
    {
      id: "bda-m1",
      title: "Queue Discipline",
      description: "Work overdue and due queues first.",
      route: CANONICAL_DOMAIN_ROUTES.CRM,
      sop: ["Use filters instead of scrolling.", "Log outcome and next follow-up on every interaction."],
    },
  ],
  workflows: [
    {
      id: "bda-w1",
      title: "Post-call save",
      trigger: "After each interaction",
      outcome: "No timeline gaps",
      steps: ["Select outcome", "Set follow-up", "Save"],
    },
  ],
  operatingRhythm: { daily: ["Clear due queues", "Close tasks"], weekly: ["Review stale lead recovery"], biWeekly: ["Review target and counselling status"] },
  shortcuts: [{ keys: "Ctrl/Cmd + K", action: "Jump to lead/task/page quickly." }],
  alerts: ["SLA risk", "Cycle close"],
  troubleshooting: [{ issue: "Lead not visible", checks: ["Clear smart filters", "Use global search", "Check owner scope"] }],
  faqs: [{ question: "Can BDA assign leads?", answer: "No. Assignment is manager-and-above." }],
  glossary: [...GLOSSARY],
};

const BDA_TRAINEE_GUIDE: RoleKnowledgeGuide = {
  ...baseGuide("BDA_TRAINEE", "BDA Trainee Knowledge Center", "Trainee manual for 15-day qualification workflow and execution discipline."),
  tourSteps: [{ id: "bdat-1", title: "Training Dashboard", description: "Track qualification window.", route: CANONICAL_DOMAIN_ROUTES.TRAINING }],
  modules: [{ id: "bdat-m1", title: "Qualification Rule", description: "One sale in 15 days.", route: CANONICAL_DOMAIN_ROUTES.TRAINING, sop: ["Track day count", "Escalate blockers early"] }],
  workflows: [{ id: "bdat-w1", title: "Daily trainee loop", trigger: "Each shift", outcome: "On-track qualification", steps: ["Review scorecard", "Run queue", "Log outcomes"] }],
  operatingRhythm: { daily: ["Track trainee scorecard"], weekly: ["Review with trainer"], biWeekly: ["Qualification review"] },
  shortcuts: [{ keys: "Ctrl/Cmd + K", action: "Jump between training and CRM." }],
  alerts: ["Qualification risk"],
  troubleshooting: [{ issue: "Qualification not updating", checks: ["Check sale posting", "Check trainee state"] }],
  faqs: [{ question: "Do trainees get BDA incentive logic?", answer: "No. Incentive starts after qualification." }],
  glossary: [...GLOSSARY],
};

const BDM_TRAINING_GUIDE: RoleKnowledgeGuide = {
  ...baseGuide("BDM_TRAINING", "BDM Training Knowledge Center", "Training-lead guide for trainee funnel control and coaching."),
  tourSteps: [{ id: "bdm-1", title: "Training", description: "Monitor trainee funnel.", route: CANONICAL_DOMAIN_ROUTES.TRAINING }],
  modules: [{ id: "bdm-m1", title: "Funnel Management", description: "Detect at-risk trainees.", route: CANONICAL_DOMAIN_ROUTES.TRAINING, sop: ["Track no-activity", "Coach near-deadline trainees"] }],
  workflows: [{ id: "bdm-w1", title: "Weekly review", trigger: "Weekly", outcome: "Clear action list", steps: ["Segment risk", "Assign coaching"] }],
  operatingRhythm: { daily: ["Review trainee risk"], weekly: ["Run readiness review"], biWeekly: ["Publish cycle summary"] },
  shortcuts: [{ keys: "Ctrl/Cmd + K", action: "Jump to training/report pages." }],
  alerts: ["Trainee risk", "Qualification pending"],
  troubleshooting: [{ issue: "Role mismatch", checks: ["Check acting-role and reporting"] }],
  faqs: [{ question: "Can BDM Training qualify trainee?", answer: "No. HR and senior-manager+ qualify trainees." }],
  glossary: [...GLOSSARY],
};

const MANAGER_GUIDE: RoleKnowledgeGuide = {
  ...baseGuide("MANAGER", "Manager and Leadership Knowledge Center", "Manager manual for assignment control, bulk operations, and KPI oversight."),
  tourSteps: [{ id: "mgr-1", title: "Team", description: "Start from manager cockpit.", route: CANONICAL_DOMAIN_ROUTES.TEAM }],
  modules: [{ id: "mgr-m1", title: "Assignment Control", description: "Ownership transfer with mandatory reason.", route: CANONICAL_DOMAIN_ROUTES.CRM, sop: ["Transfer reason mandatory", "Review transfer timeline"] }],
  workflows: [{ id: "mgr-w1", title: "Daily intervention", trigger: "Start of day", outcome: "Lower stale/SLA load", steps: ["Review heatmap", "Reassign blocked leads", "Inspect bulk logs"] }],
  operatingRhythm: { daily: ["Review queue hotspots"], weekly: ["Review backlog trends"], biWeekly: ["Close target/PIP actions"] },
  shortcuts: [{ keys: "Ctrl/Cmd + K", action: "Jump to team/CRM/reports." }],
  alerts: ["SLA breach", "Bulk failure", "PIP action due"],
  troubleshooting: [{ issue: "Owner changed but lead hidden", checks: ["Check scope", "Check custody state", "Clear filters"] }],
  faqs: [{ question: "Can managers mark absent after check-in?", answer: "Yes, with mandatory reason and audit." }],
  glossary: [...GLOSSARY],
};

const HR_GUIDE: RoleKnowledgeGuide = {
  ...baseGuide("HR", "HR Knowledge Center", "HR manual for attendance authority, leave queue, lifecycle controls, and qualification flow."),
  tourSteps: [{ id: "hr-1", title: "People Ops", description: "Canonical HR entrypoint.", route: CANONICAL_DOMAIN_ROUTES.HR }],
  modules: [{ id: "hr-m1", title: "Correction and Leave Authority", description: "Review/decide attendance corrections and leave.", route: "/hr/attendance", sop: ["Approve/reject with reason", "Verify payroll-facing status"] }],
  workflows: [{ id: "hr-w1", title: "Correction to payroll", trigger: "Correction request", outcome: "Payroll-safe final state", steps: ["Review", "Approve/reject", "Verify snapshot"] }],
  operatingRhythm: { daily: ["Clear correction/leave queues"], weekly: ["Review override trends"], biWeekly: ["Reconcile payroll-impacting changes"] },
  shortcuts: [{ keys: "Ctrl/Cmd + K", action: "Jump to HR ops quickly." }],
  alerts: ["Correction pending", "Lifecycle pending"],
  troubleshooting: [{ issue: "Missing permissions", checks: ["Check role scope", "Check rules access"] }],
  faqs: [{ question: "Can HR change roles?", answer: "Yes, where policy and scope allow, with audit reason." }],
  glossary: [...GLOSSARY],
};

const FINANCE_GUIDE: RoleKnowledgeGuide = {
  ...baseGuide("FINANCE", "Finance Knowledge Center", "Finance manual for ledger, approvals, categories, and payout workflows."),
  tourSteps: [{ id: "fin-1", title: "Finance Dashboard", description: "Ledger and controls surface.", route: CANONICAL_DOMAIN_ROUTES.FINANCE }],
  modules: [{ id: "fin-m1", title: "Approval Queue", description: "Maker-checker controls.", route: CANONICAL_DOMAIN_ROUTES.FINANCE, sop: ["Review payload/proof", "Approve/reject with notes"] }],
  workflows: [{ id: "fin-w1", title: "Daily approval cycle", trigger: "Daily", outcome: "No stale approvals", steps: ["Review queue", "Decide action", "Recheck blockers"] }],
  operatingRhythm: { daily: ["Process approvals"], weekly: ["Review category anomalies"], biWeekly: ["Finalize payroll exports"] },
  shortcuts: [{ keys: "Ctrl/Cmd + K", action: "Jump to finance/accounts/reports." }],
  alerts: ["Approval SLA risk", "Category mismatch"],
  troubleshooting: [{ issue: "Category missing", checks: ["Check credit/debit", "Refresh metadata"] }],
  faqs: [{ question: "Do sales roles see finance controls?", answer: "No. Finance controls are role-scoped." }],
  glossary: [...GLOSSARY],
};

const CHANNEL_PARTNER_GUIDE: RoleKnowledgeGuide = {
  ...baseGuide("CHANNEL_PARTNER", "Channel Partner Knowledge Center", "Partner guide for mapped lead execution and commission tracking."),
  tourSteps: [{ id: "cp-1", title: "Partner Dashboard", description: "Track sales and commission.", route: CANONICAL_DOMAIN_ROUTES.CHANNEL_PARTNER }],
  modules: [{ id: "cp-m1", title: "Mapped Lead Workflow", description: "Run partner-mapped leads.", route: CANONICAL_DOMAIN_ROUTES.CRM, sop: ["Log every interaction", "Escalate allocation conflicts"] }],
  workflows: [{ id: "cp-w1", title: "Partner closure loop", trigger: "New mapped lead", outcome: "Commission-eligible closure", steps: ["Reach out", "Set follow-up", "Close with data"] }],
  operatingRhythm: { daily: ["Work mapped queue"], weekly: ["Review conversion trend"], biWeekly: ["Reconcile commission"] },
  shortcuts: [{ keys: "Ctrl/Cmd + K", action: "Jump to partner dashboard/CRM." }],
  alerts: ["Partner follow-up overdue"],
  troubleshooting: [{ issue: "Lead missing", checks: ["Check mapping", "Clear filters"] }],
  faqs: [{ question: "Can partners reassign leads?", answer: "No. Reassignment is manager-controlled." }],
  glossary: [...GLOSSARY],
};

const SUPER_ADMIN_GUIDE: RoleKnowledgeGuide = {
  ...baseGuide("SUPER_ADMIN", "Super Admin and Admin Knowledge Center", "Full governance manual for all modules, controls, and release discipline."),
  tourSteps: [{ id: "sa-1", title: "Mission Control", description: "Executive triage.", route: CANONICAL_DOMAIN_ROUTES.SUPER_ADMIN }],
  modules: [{ id: "sa-m1", title: "Governance and Release", description: "Role/hierarchy and staged rollout controls.", route: "/super-admin/personnel", sop: ["Run UAT matrix", "Deploy in controlled sequence"] }],
  workflows: [{ id: "sa-w1", title: "Pre-release gate", trigger: "Before production", outcome: "Lower regression risk", steps: ["Run UAT", "Validate permissions", "Deploy staged"] }],
  operatingRhythm: { daily: ["Review critical exceptions"], weekly: ["Review governance backlog"], biWeekly: ["Review cross-domain outcomes"] },
  shortcuts: [{ keys: "Ctrl/Cmd + K", action: "Jump across governance modules." }],
  alerts: ["Permission-denied spikes", "Audit gaps"],
  troubleshooting: [{ issue: "Role action failed", checks: ["Check scope", "Check protected-role rules", "Inspect logs"] }],
  faqs: [{ question: "Can HR and Admin both change roles?", answer: "Yes, with scope and policy compliance." }],
  glossary: [...GLOSSARY],
};

const EMPLOYEE_GUIDE: RoleKnowledgeGuide = {
  ...baseGuide("EMPLOYEE", "Employee Knowledge Center", "Baseline employee guide for attendance, tasks, and in-app navigation."),
  tourSteps: [{ id: "emp-1", title: "My Day", description: "Daily start page.", route: CANONICAL_DOMAIN_ROUTES.MY_DAY }],
  modules: [{ id: "emp-m1", title: "Daily Basics", description: "Attendance + task discipline.", route: "/attendance", sop: ["Check attendance", "Close due tasks"] }],
  workflows: [{ id: "emp-w1", title: "Daily baseline", trigger: "Start/end of day", outcome: "No pending basics", steps: ["Check attendance", "Review tasks"] }],
  operatingRhythm: { daily: ["Attendance and tasks"], weekly: ["Review pending approvals"], biWeekly: ["Review manager feedback"] },
  shortcuts: [{ keys: "Ctrl/Cmd + K", action: "Jump quickly between allowed pages." }],
  alerts: ["Attendance missing entry", "Task overdue"],
  troubleshooting: [{ issue: "Cannot find page", checks: ["Use command bar", "Check role menu"] }],
  faqs: [{ question: "Can I view other role modules?", answer: "No. Knowledge Center is role-scoped." }],
  glossary: [...GLOSSARY],
};

const ROLE_GUIDES: Record<GuideRole, RoleKnowledgeGuide> = {
  SUPER_ADMIN: SUPER_ADMIN_GUIDE,
  MANAGER: MANAGER_GUIDE,
  BDA: BDA_GUIDE,
  BDA_TRAINEE: BDA_TRAINEE_GUIDE,
  BDM_TRAINING: BDM_TRAINING_GUIDE,
  HR: HR_GUIDE,
  FINANCE: FINANCE_GUIDE,
  CHANNEL_PARTNER: CHANNEL_PARTNER_GUIDE,
  EMPLOYEE: EMPLOYEE_GUIDE,
};

export function resolveGuideRole(role: CanonicalRole): GuideRole {
  switch (role) {
    case "SUPER_ADMIN":
    case "ADMIN":
      return "SUPER_ADMIN";
    case "MANAGER":
    case "SENIOR_MANAGER":
    case "GM":
    case "AVP":
    case "VP":
    case "SALES_HEAD":
    case "CBO":
    case "CEO":
    case "TEAM_LEAD":
      return "MANAGER";
    case "BDA":
      return "BDA";
    case "BDA_TRAINEE":
      return "BDA_TRAINEE";
    case "BDM_TRAINING":
      return "BDM_TRAINING";
    case "HR":
      return "HR";
    case "FINANCER":
      return "FINANCE";
    case "CHANNEL_PARTNER":
      return "CHANNEL_PARTNER";
    case "EMPLOYEE":
    case "UNKNOWN":
    default:
      return "EMPLOYEE";
  }
}

export function getRoleKnowledgeGuide(role: CanonicalRole): RoleKnowledgeGuide {
  const guide = ROLE_GUIDES[resolveGuideRole(role)];
  return {
    ...guide,
    tourSteps: guide.tourSteps.map((step) => ({ ...step })),
    modules: guide.modules.map((item) => ({ ...item, sop: [...item.sop] })),
    workflows: guide.workflows.map((item) => ({ ...item, steps: [...item.steps] })),
    moduleCatalog: guide.moduleCatalog.map((item) => ({
      ...item,
      features: [...item.features],
      actions: [...item.actions],
      entities: [...item.entities],
      permissions: item.permissions ? [...item.permissions] : undefined,
      handoffs: item.handoffs ? [...item.handoffs] : undefined,
    })),
    operatingRhythm: {
      daily: [...guide.operatingRhythm.daily],
      weekly: [...guide.operatingRhythm.weekly],
      biWeekly: [...guide.operatingRhythm.biWeekly],
    },
    shortcuts: guide.shortcuts.map((item) => ({ ...item })),
    alerts: [...guide.alerts],
    troubleshooting: guide.troubleshooting.map((item) => ({ ...item, checks: [...item.checks] })),
    faqs: guide.faqs.map((item) => ({ ...item })),
    glossary: guide.glossary.map((item) => ({ ...item })),
  };
}
