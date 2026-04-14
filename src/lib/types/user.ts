export type UserRole =
  | "admin"
  | "teamLead"
  | "employee"
  | "manager"
  | "financer"
  | "EMPLOYEE"
  | "TEAM_LEAD"
  | "MANAGER"
  | "FINANCER"
  | "HR"
  | "hr"
  | "bda"
  | "BDA"
  | "channelPartner"
  | "CHANNEL_PARTNER"
  | "bdaTrainee"
  | "BDA_TRAINEE"
  | "bdmTraining"
  | "BDM_TRAINING"
  | "seniorManager"
  | "gm"
  | "avp"
  | "vp"
  | "salesHead"
  | "cbo"
  | "ceo"
  | (string & {});

export type OrgUserRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "MANAGER"
  | "SENIOR_MANAGER"
  | "GM"
  | "AVP"
  | "VP"
  | "SALES_HEAD"
  | "CBO"
  | "CEO"
  | "EMPLOYEE"
  | "TEAM_LEAD"
  | "BDA"
  | "CHANNEL_PARTNER"
  | "BDA_TRAINEE"
  | "BDM_TRAINING"
  | "FINANCER"
  | "bda"
  | "channel_partner"
  | "bda_trainee"
  | "bdm_training"
  | "manager"
  | "senior_manager"
  | "gm"
  | "avp"
  | "vp"
  | "sales_head"
  | "cbo"
  | "ceo"
  | "super_admin"
  | "team_lead"
  | "financer"
  | "HR"
  | "hr"
  | (string & {});

export type UserAccountStatus = "active" | "inactive" | "terminated" | "Terminated";

export type UserLifecycleState = "active" | "deactivated" | "inactive_till" | "terminated";

export type UserDoc = {
  uid: string;
  employeeId?: string | null;
  email: string | null;
  displayName: string | null;
  designation?: string | null;
  department?: string | null;
  joiningDate?: unknown;
  salary?: number | null;
  photoURL?: string | null;
  name?: string | null;
  phone: string | null;
  alternateEmail?: string | null;
  alternatePhone?: string | null;
  address?: string | null;
  settings?: {
    workspace?: "HR" | "CRM" | null;
  } | null;
  role: UserRole;
  orgRole?: OrgUserRole | null;
  status: UserAccountStatus;
  isActive?: boolean | null;
  managerId?: string | null;
  teamLeadId: string | null;
  supervisorId?: string | null;
  reportsTo?: string | null;
  temporaryReportsTo?: string | null;
  temporaryReportsToUntil?: unknown;
  temporaryReportsToReason?: string | null;
  actingManagerId?: string | null;
  actingRole?: UserRole | null;
  actingOrgRole?: OrgUserRole | null;
  actingRoleUntil?: unknown;
  assignedHR?: string | null;
  lifecycleState?: UserLifecycleState | null;
  inactiveUntil?: unknown;
  deactivatedAt?: unknown;
  deactivatedBy?: {
    uid: string;
    name?: string | null;
    role?: string | null;
    employeeId?: string | null;
  } | null;
  deactivatedReason?: string | null;
  terminatedAt?: unknown;
  terminatedBy?: {
    uid: string;
    name?: string | null;
    role?: string | null;
    employeeId?: string | null;
  } | null;
  terminatedReason?: string | null;
  reactivatedAt?: unknown;
  reactivatedBy?: {
    uid: string;
    name?: string | null;
    role?: string | null;
    employeeId?: string | null;
  } | null;
  reactivatedReason?: string | null;
  managerNote?: string | null;
  traineeProgram?: {
    status?: "active" | "qualified" | "expired" | "inactive" | null;
    startedAt?: unknown;
    expectedEndAt?: unknown;
    requiredSales?: number;
    requiredDays?: number;
    qualifiedAt?: unknown;
    qualifiedBy?: {
      uid: string;
      name?: string | null;
      role?: string | null;
      employeeId?: string | null;
    } | null;
    qualificationReason?: string | null;
    qualificationSales?: number;
  } | null;
  monthlyTarget?: number | null;
  crmDailyLeadCapacity?: number | null;
  crmMaxOpenLeads?: number | null;
  autoAssignLeads?: boolean | null;
  salaryStructure?: {
    base: number;
    bonusRate: number;
    deductionRate: number;
    hra?: number;
    studyAllowance?: number;
    professionalTax?: number;
    pf?: number;
    insurance?: number;
    earnings?: Array<{
      label: string;
      amount: number;
    }>;
    deductions?: Array<{
      label: string;
      amount: number;
    }>;
  } | null;
  payroll?: {
    baseSalary?: number;
    allowances?: {
      hra?: number;
      travel?: number;
      bonus?: number;
    } | null;
    deductions?: {
      professionalTax?: number;
      pf?: number;
      insurance?: number;
    } | null;
    taxRegime?: "OLD_REGIME" | "NEW_REGIME" | null;
    bankDetails?: {
      accountNumber?: string | null;
      ifsc?: string | null;
    } | null;
  } | null;
  onboardingCompleted?: boolean;
  onboardingTimestamp?: unknown;
  kycDetails?: {
    aadhar: string | null;
    pan: string | null;
    bankAccount?: string | null;
    ifsc?: string | null;
    education?: string | null;
    university?: string | null;
    address: string | null;
    parentDetails: string | null;
  } | null;
  keys?: {
    publicKey: string; // Base64 SPKI
    encryptedPrivateKey?: string; // Optional: Encrypted backup for cross-device
  };
  lastLogin?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};
