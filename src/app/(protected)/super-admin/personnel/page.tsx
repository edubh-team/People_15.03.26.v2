"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { updateEmployeeLifecycle } from "@/app/actions/hr";
import { db } from "@/lib/firebase/client";
import { doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, getDoc, Timestamp } from "firebase/firestore";
import type { UserDoc } from "@/lib/types/user";
import { generateUniqueEmployeeId } from "@/lib/utils/employeeIdGenerator";
import { UserPlusIcon, CheckCircleIcon, ExclamationTriangleIcon, IdentificationIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { initializeApp, deleteApp, FirebaseApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import EmployeeDossierModal from "@/components/super-admin/EmployeeDossierModal";
import { formatRoleLabel, isAdminUser, isHrUser, normalizeRoleValue } from "@/lib/access";
import {
  getSalesHierarchyRank,
} from "@/lib/sales/hierarchy";
import Pagination from "@/components/ui/Pagination";
import {
  PeopleDirectoryFiltersBar,
  PeopleDirectoryList,
  PeopleDirectoryStatsStrip,
} from "@/components/people/PeopleDirectoryShared";
import {
  buildPeopleDirectoryStats,
  filterPeopleDirectoryUsers,
  paginatePeopleDirectoryUsers,
  usePeopleDirectoryData,
} from "@/lib/people/directory";

const SALES_ROLE_OPTIONS = [
  { label: "BDA (Trainee)", value: "BDA_TRAINEE" },
  { label: "BDA", value: "BDA" },
  { label: "Channel Partner", value: "CHANNEL_PARTNER" },
  { label: "BDM (Training)", value: "BDM_TRAINING" },
  { label: "Team Lead", value: "TEAM_LEAD" },
  { label: "Manager", value: "MANAGER" },
  { label: "Senior Manager", value: "SENIOR_MANAGER" },
  { label: "GM", value: "GM" },
  { label: "AVP", value: "AVP" },
  { label: "VP", value: "VP" },
  { label: "Sales Head", value: "SALES_HEAD" },
  { label: "CBO", value: "CBO" },
  { label: "CEO", value: "CEO" },
];

const ORG_ROLES = [
  ...SALES_ROLE_OPTIONS,
  { label: "HR", value: "HR" },
  { label: "Financer", value: "FINANCER" },
];

const FIXED_ROLES = ["SUPER_ADMIN", "ADMIN"];
type OverrideMode = "permanent" | "temporary";

function mapOrgRoleToSystemRole(selectedOrgRole: string): UserDoc["role"] {
  const normalized = normalizeRoleValue(selectedOrgRole);

  switch (normalized) {
    case "BDA_TRAINEE":
    case "CHANNEL_PARTNER":
    case "BDM_TRAINING":
      return "employee";
    case "TEAM_LEAD":
      return "teamLead";
    case "MANAGER":
    case "SENIOR_MANAGER":
    case "GM":
    case "AVP":
    case "VP":
    case "SALES_HEAD":
    case "CBO":
    case "CEO":
      return "manager";
    case "HR":
      return "HR";
    case "FINANCER":
      return "FINANCER";
    default:
      return "employee";
  }
}

function toDateTimeLocalValue(value: unknown) {
  if (!value) return "";
  const date =
    value instanceof Timestamp
      ? value.toDate()
      : value instanceof Date
        ? value
        : new Date(value as string | number);

  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatSupervisorLabel(user: UserDoc) {
  return `${user.displayName ?? user.email ?? user.uid} (${formatRoleLabel(user.orgRole ?? user.role)})`;
}

export default function PersonnelStudioPage() {
  const { firebaseUser } = useAuth();
  const {
    allUsers: users,
    visibleUsers,
    supervisors,
    hrUsers,
    loading: directoryLoading,
    error: directoryError,
  } = usePeopleDirectoryData({
    includeExecutiveControl: true,
    sortMode: "created_desc",
  });
  const [selected, setSelected] = useState<UserDoc | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [roleGroupFilter, setRoleGroupFilter] = useState<
    "all" | "sales" | "hr" | "finance" | "executive"
  >("all");
  const [supervisorFilter, setSupervisorFilter] = useState<string>("all");
  const [continuityFilter, setContinuityFilter] = useState<
    "all" | "acting_manager" | "temporary_reporting" | "needs_supervisor"
  >("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;
  const [selectedOrgRole, setSelectedOrgRole] = useState<string>("BDA");
  const [reportsTo, setReportsTo] = useState<string>("");
  const [temporaryReportsTo, setTemporaryReportsTo] = useState<string>("");
  const [temporaryReportsToUntil, setTemporaryReportsToUntil] = useState<string>("");
  const [temporaryReportsToReason, setTemporaryReportsToReason] = useState<string>("");
  const [actingOrgRole, setActingOrgRole] = useState<string>("");
  const [actingRoleUntil, setActingRoleUntil] = useState<string>("");
  const [reportingMode, setReportingMode] = useState<OverrideMode>("permanent");
  const [actingMode, setActingMode] = useState<OverrideMode>("permanent");
  const [assignedHR, setAssignedHR] = useState<string>("");
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHiring, setShowHiring] = useState(false);
  const [dossierOpen, setDossierOpen] = useState(false);

  // Hiring Form State
  const [newHire, setNewHire] = useState({
    email: "",
    name: "",
    phoneNumber: "",
    role: "employee",
    orgRole: "BDA",
    reportsTo: "",
    assignedHR: "",
    baseSalary: 0,
  });

  const handleOrgRoleChange = (selectedOrgRole: string) => {
    const mappedSystemRole = mapOrgRoleToSystemRole(selectedOrgRole);
    setNewHire(prev => ({
      ...prev,
      orgRole: selectedOrgRole,
      role: mappedSystemRole || prev.role
    }));
  };
  const [successData, setSuccessData] = useState<{email: string, password: string} | null>(null);

  // Lifecycle State
  const [showLifecycle, setShowLifecycle] = useState(false);
  const [lifecycleConfirm, setLifecycleConfirm] = useState("");
  const [lifecycleAction, setLifecycleAction] = useState<"deactivate" | "inactive_till" | "terminate">("deactivate");
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [inactiveUntil, setInactiveUntil] = useState("");
  const [additionalSupervisor, setAdditionalSupervisor] = useState<UserDoc | null>(null);

  const baseFilteredUsers = useMemo(
    () => filterPeopleDirectoryUsers(visibleUsers, { searchTerm, roleFilter, statusFilter }),
    [roleFilter, searchTerm, statusFilter, visibleUsers],
  );
  const supervisorOptions = useMemo(() => {
    const map = new Map<string, UserDoc>();
    supervisors.forEach((supervisor) => map.set(supervisor.uid, supervisor));
    if (additionalSupervisor?.uid) {
      map.set(additionalSupervisor.uid, additionalSupervisor);
    }
    return Array.from(map.values()).sort((left, right) =>
      formatSupervisorLabel(left).localeCompare(formatSupervisorLabel(right)),
    );
  }, [additionalSupervisor, supervisors]);
  const filteredUsers = useMemo(() => {
    return baseFilteredUsers.filter((user) => {
      const normalizedRole = normalizeRoleValue(user.orgRole ?? user.role);
      const roleRank = getSalesHierarchyRank(user);
      const isExecutive = normalizedRole === "SUPER_ADMIN" || normalizedRole === "ADMIN";

      if (roleGroupFilter === "sales" && roleRank < 0) return false;
      if (roleGroupFilter === "hr" && normalizedRole !== "HR") return false;
      if (roleGroupFilter === "finance" && normalizedRole !== "FINANCER") return false;
      if (roleGroupFilter === "executive" && !isExecutive) return false;

      const reportingTo = user.reportsTo ?? user.teamLeadId ?? "";
      if (supervisorFilter === "unassigned" && reportingTo) return false;
      if (
        supervisorFilter !== "all" &&
        supervisorFilter !== "unassigned" &&
        reportingTo !== supervisorFilter
      ) {
        return false;
      }

      if (continuityFilter === "acting_manager" && !user.actingManagerId) return false;
      if (continuityFilter === "temporary_reporting" && !user.temporaryReportsTo) return false;
      if (continuityFilter === "needs_supervisor" && reportingTo) return false;

      return true;
    });
  }, [baseFilteredUsers, continuityFilter, roleGroupFilter, supervisorFilter]);
  const paginatedUsers = useMemo(
    () => paginatePeopleDirectoryUsers(filteredUsers, currentPage, itemsPerPage),
    [currentPage, filteredUsers],
  );
  const stats = useMemo(() => buildPeopleDirectoryStats(visibleUsers), [visibleUsers]);

  useEffect(() => {
    if (!selected) return;

    const currentOrgRole = normalizeRoleValue(selected.orgRole ?? selected.role);
    setSelectedOrgRole(currentOrgRole === "UNKNOWN" ? "BDA" : currentOrgRole);
    const currentReportsTo = selected.reportsTo ?? selected.teamLeadId ?? "";
    setReportsTo(currentReportsTo);
    setTemporaryReportsTo(selected.temporaryReportsTo ?? "");
    setTemporaryReportsToUntil(toDateTimeLocalValue(selected.temporaryReportsToUntil));
    setTemporaryReportsToReason(selected.temporaryReportsToReason ?? "");
    setReportingMode(selected.temporaryReportsTo ? "temporary" : "permanent");
    const currentActingRole = normalizeRoleValue(selected.actingOrgRole ?? selected.actingRole);
    setActingOrgRole(currentActingRole === "UNKNOWN" ? "" : currentActingRole);
    setActingRoleUntil(toDateTimeLocalValue(selected.actingRoleUntil));
    setActingMode(selected.actingOrgRole || selected.actingRole ? "temporary" : "permanent");
    setAssignedHR(selected.assignedHR || "");
    setShowLifecycle(false);
    setLifecycleConfirm("");
    setLifecycleReason("");
    setInactiveUntil("");
    setLifecycleAction("deactivate");
    setAdditionalSupervisor(null);
    setSaveMessage(null);

    // If the current supervisor is not in the list, fetch them
    if (currentReportsTo && !supervisors.find(u => u.uid === currentReportsTo)) {
        if (!db) return;
        // Use a local variable to satisfy TypeScript null checks
        const firestore = db;
        getDoc(doc(firestore, "users", currentReportsTo)).then((snap) => {
            if (snap.exists()) {
                setAdditionalSupervisor({ ...(snap.data() as UserDoc), uid: snap.id });
            }
        }).catch((err: unknown) => console.error("Error fetching missing supervisor:", err));
    }
  }, [selected, supervisors]);

  useEffect(() => {
    if (supervisorFilter === "all" || supervisorFilter === "unassigned") return;
    if (supervisorOptions.some((user) => user.uid === supervisorFilter)) return;
    setSupervisorFilter("all");
  }, [supervisorFilter, supervisorOptions]);

  useEffect(() => {
    if (reportingMode === "permanent") {
      setTemporaryReportsTo("");
      setTemporaryReportsToUntil("");
      setTemporaryReportsToReason("");
    }
  }, [reportingMode]);

  useEffect(() => {
    if (actingMode === "permanent") {
      setActingOrgRole("");
      setActingRoleUntil("");
    }
  }, [actingMode]);

  async function applyChanges() {
    if (!db || !selected) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const ref = doc(db, "users", selected.uid);
      const normalizedSelectedOrgRole = normalizeRoleValue(selectedOrgRole);
      const nextReportsTo = reportsTo || null;
      const nextTemporaryReportsTo =
        reportingMode === "temporary" ? temporaryReportsTo || null : null;
      const nextTemporaryReportsToUntil =
        reportingMode === "temporary" && temporaryReportsToUntil
          ? new Date(temporaryReportsToUntil)
          : null;
      const nextTemporaryReportsToReason =
        reportingMode === "temporary"
          ? temporaryReportsToReason.trim() || null
          : null;
      const nextActingOrgRole =
        actingMode === "temporary" && actingOrgRole
          ? (actingOrgRole as UserDoc["orgRole"])
          : null;
      const nextActingRole =
        nextActingOrgRole ? mapOrgRoleToSystemRole(nextActingOrgRole) : null;
      const nextActingRoleUntil =
        actingMode === "temporary" && actingRoleUntil ? new Date(actingRoleUntil) : null;

      if (reportingMode === "temporary") {
        if (!nextTemporaryReportsTo) {
          throw new Error("Select a temporary reporting manager.");
        }
        if (!nextTemporaryReportsToUntil) {
          throw new Error("Set temporary reporting end date/time.");
        }
        if (!nextTemporaryReportsToReason) {
          throw new Error("Temporary reporting reason is required.");
        }
      }

      if (actingMode === "temporary") {
        if (!nextActingOrgRole) {
          throw new Error("Select an acting role.");
        }
        if (!nextActingRoleUntil) {
          throw new Error("Set acting role end date/time.");
        }
      }

      const payload: Partial<UserDoc> = {
        reportsTo: nextReportsTo,
        teamLeadId: nextReportsTo,
        temporaryReportsTo: nextTemporaryReportsTo,
        temporaryReportsToUntil: nextTemporaryReportsToUntil,
        temporaryReportsToReason: nextTemporaryReportsToReason,
        actingManagerId: nextTemporaryReportsTo,
        actingOrgRole: nextActingOrgRole,
        actingRole: nextActingRole,
        actingRoleUntil: nextActingRoleUntil,
        assignedHR: assignedHR || null,
        updatedAt: serverTimestamp(),
      };

      // Only update role/orgRole if NOT a fixed role
      const userOrgRole = normalizeRoleValue(selected.orgRole ?? selected.role);
      const isFixedRole = FIXED_ROLES.includes(userOrgRole);

      let nextOrg: UserDoc["orgRole"] = "BDA";
      let nextRole: UserDoc["role"] = "employee";

      if (!isFixedRole) {
        nextOrg = (normalizedSelectedOrgRole === "UNKNOWN"
          ? "BDA"
          : normalizedSelectedOrgRole) as UserDoc["orgRole"];
        nextRole = mapOrgRoleToSystemRole(nextOrg ?? "BDA");
        payload.orgRole = nextOrg;
        payload.role = nextRole;

        if (nextOrg === "BDA_TRAINEE") {
          payload.traineeProgram = {
            status: "active",
            startedAt: selected.traineeProgram?.startedAt ?? serverTimestamp(),
            expectedEndAt: selected.traineeProgram?.expectedEndAt ?? null,
            requiredSales: 1,
            requiredDays: 15,
            qualifiedAt: null,
            qualifiedBy: null,
            qualificationReason: null,
            qualificationSales: 0,
          };
        }
      }

      await updateDoc(ref, payload);
      
      // Update local state to reflect changes immediately
      setSelected(prev => {
        if (!prev) return null;
        return {
           ...prev,
           reportsTo: nextReportsTo,
           teamLeadId: nextReportsTo,
           temporaryReportsTo: nextTemporaryReportsTo,
           temporaryReportsToUntil: nextTemporaryReportsToUntil,
           temporaryReportsToReason: nextTemporaryReportsToReason,
           actingManagerId: nextTemporaryReportsTo,
           actingOrgRole: nextActingOrgRole,
           actingRole: nextActingRole,
           actingRoleUntil: nextActingRoleUntil,
           assignedHR: assignedHR || null,
           ...(payload.role ? { role: payload.role } : {}),
           ...(payload.orgRole ? { orgRole: payload.orgRole as UserDoc["orgRole"] } : {}),
           ...(payload.traineeProgram ? { traineeProgram: payload.traineeProgram } : {}),
        };
      });
      setSaveMessage({ type: "success", text: "Changes applied successfully." });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to apply changes.";
      setSaveMessage({ type: "error", text: message });
    } finally {
      setSaving(false);
    }
  }

  async function handleHire() {
    setSaving(true);
    let secondaryApp: FirebaseApp | null = null;

    try {
      if (!db) throw new Error("Database not initialized");

      // 1. Configure Secondary App (Client-side workaround for Service Account restrictions)
      const firebaseConfig = {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      };

      // Initialize a secondary app instance to create the user without signing out the admin
      // We use a timestamp to make the app name unique every time to avoid conflicts
      const appName = `SecondaryApp-${Date.now()}`;
      secondaryApp = initializeApp(firebaseConfig, appName);
      const secondaryAuth = getAuth(secondaryApp);

      // 2. Create User in Auth (Isolated)
      const tempPassword = Math.random().toString(36).slice(-8) + "Aa1!"; // Temporary password
      const userCred = await createUserWithEmailAndPassword(secondaryAuth, newHire.email, tempPassword);
      const uid = userCred.user.uid;
      
      console.log("User created in Auth:", uid);

      // 3. Generate Employee ID
      const employeeId = await generateUniqueEmployeeId();
      
      // 4. Create User Document (using MAIN app's db which has admin auth)
      const userRef = doc(db, "users", uid);
      await setDoc(userRef, {
        uid,
        email: newHire.email,
        displayName: newHire.name,
        role: newHire.role,
        orgRole: newHire.orgRole,
        status: "active",
        teamLeadId: newHire.reportsTo || null,
        reportsTo: newHire.reportsTo || null,
        temporaryReportsTo: null,
        temporaryReportsToUntil: null,
        temporaryReportsToReason: null,
        actingManagerId: null,
        actingRole: null,
        actingOrgRole: null,
        actingRoleUntil: null,
        assignedHR: newHire.assignedHR || null,
        employeeId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        photoURL: null,
        phone: newHire.phoneNumber || null,
        phoneNumber: newHire.phoneNumber || null,
        traineeProgram:
          newHire.orgRole === "BDA_TRAINEE"
            ? {
                status: "active",
                startedAt: serverTimestamp(),
                expectedEndAt: null,
                requiredSales: 1,
                requiredDays: 15,
                qualifiedAt: null,
                qualifiedBy: null,
                qualificationReason: null,
                qualificationSales: 0,
              }
            : null,
      });

      // 5. Create Payroll Doc
      if (newHire.baseSalary > 0) {
        const payrollRef = doc(db, "payroll", uid);
        await setDoc(payrollRef, {
          uid,
          baseSalary: Number(newHire.baseSalary),
          allowances: { hra: 0, travel: 0, bonus: 0 },
          taxRegime: "NEW_REGIME",
          bankDetails: { accountNumber: "", ifsc: "" },
        });
      }

      // 6. Send Onboarding Email (Blocking with error check)
      try {
        const emailRes = await fetch("/api/email/send-onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: newHire.email,
            name: newHire.name,
            password: tempPassword,
            role: newHire.role,
          }),
        });

        if (!emailRes.ok) {
          const errData = await emailRes.json();
          console.error("Email API failed:", errData);
          const rawError = errData.raw ? JSON.stringify(errData.raw, null, 2) : (errData.error || "Unknown error");
          alert(`User created successfully, BUT the welcome email failed to send.\n\nReason: ${rawError}\n\nPlease share this password manually: ${tempPassword}`);
        }
      } catch (emailNetworkError) {
        console.error("Failed to call email API:", emailNetworkError);
        alert(`User created successfully, BUT the welcome email failed to send (Network Error).\n\nPlease share this password manually: ${tempPassword}`);
      }

      // 7. Show Success Screen
      setSuccessData({ email: newHire.email, password: tempPassword });
      
    } catch (error: unknown) {
      let errorMessage = "Unknown error";
      const firebaseError = error as { code?: string; message?: string };
      let isExpectedError = false;

      if (typeof error === 'object' && error !== null && 'code' in error) {
        switch (firebaseError.code) {
          case 'auth/email-already-in-use':
            errorMessage = "This email is already registered. Please use a different email.";
            isExpectedError = true;
            break;
          case 'auth/invalid-email':
            errorMessage = "The email address is invalid.";
            isExpectedError = true;
            break;
          case 'auth/operation-not-allowed':
            errorMessage = "Email/Password sign-in is not enabled in Firebase Console.";
            break;
          case 'auth/weak-password':
            errorMessage = "The generated password was too weak.";
            isExpectedError = true;
            break;
          default:
            errorMessage = `${firebaseError.code}: ${firebaseError.message}`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      // Only log unexpected errors to the console
      if (!isExpectedError) {
        console.error("Error creating user:", error);
      }

      alert(`Failed to create user: ${errorMessage}`);
    } finally {
      // 7. Cleanup Secondary App
      if (secondaryApp) {
        try {
          const secondaryAuth = getAuth(secondaryApp);
          await signOut(secondaryAuth);
          await deleteApp(secondaryApp);
        } catch (cleanupError) {
          console.error("Error cleaning up secondary app:", cleanupError);
        }
      }
      setSaving(false);
    }
  }

  async function handleLifecycleAction() {
    if (!selected || !firebaseUser) return;
    setSaving(true);
    try {
      const token = await firebaseUser.getIdToken();
      const result = await updateEmployeeLifecycle({
        targetUid: selected.uid,
        action: lifecycleAction,
        reason: lifecycleReason,
        callerIdToken: token,
        inactiveUntil: lifecycleAction === "inactive_till" ? inactiveUntil : null,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      setShowLifecycle(false);
      setSelected(null);
      setLifecycleConfirm("");
      setLifecycleReason("");
      setInactiveUntil("");
      alert(
        [
          result.message || "Lifecycle action applied.",
          typeof result.transferredLeads === "number"
            ? `Active leads transferred: ${result.transferredLeads}.`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (e: unknown) {
      alert("Lifecycle action failed: " + (e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setSaving(false);
    }
  }

  const mx = "rounded-[24px] border border-white/20 bg-white/60 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.06)] backdrop-blur-2xl flex flex-col";

  return (
    <AuthGate allowIf={(user) => isAdminUser(user) || isHrUser(user)}>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <div className="mx-auto max-w-7xl px-6 py-10 min-h-screen flex flex-col">
          <div className="mb-6 flex items-center justify-between shrink-0">
            <div>
              <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Personnel Management</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Personnel Studio</h1>
            </div>
            <button
              onClick={() => setShowHiring(true)}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 shadow-sm"
            >
              <UserPlusIcon className="h-5 w-5" />
              New Hire
            </button>
          </div>

          <div className="mb-6">
            <PeopleDirectoryStatsStrip stats={stats} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[360px_1fr] flex-1 pb-6">
            {/* Directory Column */}
            <div className={`${mx} h-[calc(100vh-140px)] overflow-hidden`}>
              <div className="mb-4 shrink-0">
                <div className="text-sm font-semibold tracking-tight text-slate-900">Directory</div>
                <div className="mt-1 text-xs text-slate-500">Shared directory data and filters, with admin and HR actions in the action center.</div>
              </div>
              <div className="mb-4 shrink-0">
                <PeopleDirectoryFiltersBar
                  compact
                  searchTerm={searchTerm}
                  roleFilter={roleFilter}
                  statusFilter={statusFilter}
                  onSearchTermChange={(value) => {
                    setSearchTerm(value);
                    setCurrentPage(1);
                  }}
                  onRoleFilterChange={(value) => {
                    setRoleFilter(value);
                    setCurrentPage(1);
                  }}
                  onStatusFilterChange={(value) => {
                    setStatusFilter(value);
                    setCurrentPage(1);
                  }}
                />
              </div>
              <div className="mb-4 grid shrink-0 gap-2 sm:grid-cols-2">
                <select
                  value={roleGroupFilter}
                  onChange={(event) => {
                    setRoleGroupFilter(
                      event.target.value as "all" | "sales" | "hr" | "finance" | "executive",
                    );
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                >
                  <option value="all">All role groups</option>
                  <option value="sales">Sales hierarchy only</option>
                  <option value="hr">HR only</option>
                  <option value="finance">Finance only</option>
                  <option value="executive">Executive control roles</option>
                </select>
                <select
                  value={supervisorFilter}
                  onChange={(event) => {
                    setSupervisorFilter(event.target.value);
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                >
                  <option value="all">All supervisors</option>
                  <option value="unassigned">No supervisor assigned</option>
                  {supervisorOptions.map((supervisor) => (
                    <option key={supervisor.uid} value={supervisor.uid}>
                      {formatSupervisorLabel(supervisor)}
                    </option>
                  ))}
                </select>
                <select
                  value={continuityFilter}
                  onChange={(event) => {
                    setContinuityFilter(
                      event.target.value as
                        | "all"
                        | "acting_manager"
                        | "temporary_reporting"
                        | "needs_supervisor",
                    );
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 sm:col-span-2"
                >
                  <option value="all">All continuity states</option>
                  <option value="acting_manager">Acting manager active</option>
                  <option value="temporary_reporting">Temporary reporting active</option>
                  <option value="needs_supervisor">Needs supervisor mapping</option>
                </select>
              </div>
              <div className="flex-1 overflow-y-auto pr-2">
                {directoryLoading ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                    Loading directory...
                  </div>
                ) : directoryError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-10 text-center text-sm text-rose-700">
                    {directoryError.message}
                  </div>
                ) : (
                  <PeopleDirectoryList
                    users={paginatedUsers}
                    selectedUid={selected?.uid ?? null}
                    onSelect={setSelected}
                    emptyLabel="No users match the current filters."
                  />
                )}
              </div>
              <div className="mt-4 shrink-0 border-t border-slate-200 pt-3">
                <Pagination
                  currentPage={currentPage}
                  itemsPerPage={itemsPerPage}
                  totalCurrentItems={paginatedUsers.length}
                  totalItems={filteredUsers.length}
                  hasMore={currentPage * itemsPerPage < filteredUsers.length}
                  loading={directoryLoading}
                  onPrev={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  onNext={() => setCurrentPage((page) => page + 1)}
                  label="users"
                />
              </div>
            </div>
            {/* Action Center Column */}
            <div className={`${mx} h-[calc(100vh-140px)] overflow-hidden`}>
              <div className="text-sm font-semibold tracking-tight text-slate-900 mb-4 shrink-0">
                {showHiring ? "Hiring Portal" : "Action Center"}
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2">
                {showHiring ? (
                  successData ? (
                    <div className="max-w-xl mx-auto space-y-6 text-center pt-10">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                            <CheckCircleIcon className="h-6 w-6 text-emerald-600" aria-hidden="true" />
                        </div>
                        <h3 className="text-lg font-medium leading-6 text-gray-900">User Created Successfully</h3>
                        <div className="bg-slate-50 p-6 rounded-xl text-left border border-slate-200 shadow-sm">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Email Address</p>
                            <p className="font-mono text-base font-medium text-slate-900 mb-4 select-all">{successData.email}</p>
                            
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Temporary Password</p>
                            <div className="flex items-center gap-2">
                                <p className="font-mono text-base font-medium text-slate-900 select-all bg-white px-2 py-1 rounded border border-slate-200">{successData.password}</p>
                            </div>
                        </div>
                        <p className="text-sm text-slate-500 max-w-sm mx-auto">
                            An onboarding email with these credentials is being sent to the user.
                        </p>
                        <button
                            onClick={() => {
                                setShowHiring(false);
                                setSuccessData(null);
                            setNewHire({
                                    email: "",
                                    name: "",
                                    phoneNumber: "",
                                    role: "employee",
                                    orgRole: "BDA",
                                    reportsTo: "",
                                    assignedHR: "",
                                    baseSalary: 0,
                                });
                            }}
                            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 shadow-sm"
                        >
                            Done
                        </button>
                    </div>
                  ) : (
                  <div className="max-w-xl mx-auto space-y-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="col-span-2">
                        <label className="text-xs font-semibold text-slate-500">Full Name</label>
                        <input
                          type="text"
                          className="w-full rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                          value={newHire.name}
                          onChange={e => setNewHire({...newHire, name: e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-500">Email</label>
                        <input
                          type="email"
                          className="w-full rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                          value={newHire.email}
                          onChange={e => setNewHire({...newHire, email: e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-500">Phone Number</label>
                        <input
                          type="tel"
                          className="w-full rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                          value={newHire.phoneNumber}
                          onChange={e => setNewHire({...newHire, phoneNumber: e.target.value})}
                        />
                      </div>
                      {/* 1. ORGANIZATIONAL ROLE (Department/Group) */}
                      <div>
                        <label className="text-xs font-semibold text-slate-500">Organizational Role</label>
                        <select
                          className="w-full rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                          value={newHire.orgRole}
                          onChange={e => handleOrgRoleChange(e.target.value)}
                        >
                          {ORG_ROLES.map((role) => (
                            <option key={role.value} value={role.value}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[10px] text-slate-400">Defines the user&apos;s business vertical.</p>
                      </div>

                      {/* 2. WORKING ROLE (Permissions) */}
                      <div>
                        <label className="text-xs font-semibold text-slate-500">System Permission (Auto-Assigned)</label>
                        <input
                          type="text"
                          className="w-full rounded-lg border-slate-200 bg-gray-100 px-3 py-2 text-sm text-slate-500 cursor-not-allowed capitalize"
                          value={newHire.role}
                          disabled
                          readOnly
                        />
                        <p className="mt-1 text-[10px] text-slate-400">Permissions are automatically set based on the organizational role.</p>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-500">Base Salary (â‚¹/yr)</label>
                        <input
                          type="number"
                          className="w-full rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                          value={newHire.baseSalary}
                          onChange={e => setNewHire({...newHire, baseSalary: Number(e.target.value)})}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-500">Reports To</label>
                        <select
                          className="w-full rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                          value={newHire.reportsTo}
                          onChange={e => setNewHire({...newHire, reportsTo: e.target.value})}
                        >
                          <option value="">â€” Select Supervisor â€”</option>
                          {supervisors.map((u) => (
                            <option key={u.uid} value={u.uid}>
                              {formatSupervisorLabel(u)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-500">Assigned HR</label>
                        <select
                          className="w-full rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                          value={newHire.assignedHR}
                          onChange={e => setNewHire({...newHire, assignedHR: e.target.value})}
                        >
                          <option value="">â€” Select HR â€”</option>
                          {hrUsers.map((u) => (
                            <option key={u.uid} value={u.uid}>
                              {formatSupervisorLabel(u)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                      <button
                        onClick={() => setShowHiring(false)}
                        className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void handleHire()}
                        disabled={saving}
                        className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg disabled:opacity-50"
                      >
                        {saving ? "Creating..." : "Generate Credentials"}
                      </button>
                    </div>
                  </div>
                )) : !selected ? (
                  <div className="flex h-full items-center justify-center text-slate-400 text-sm">
                    Select a user from the directory to view details.
                  </div>
                ) : (
                  <div className="space-y-8 max-w-2xl mx-auto">
                    {/* User Header */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-bold text-slate-900">{selected.displayName ?? "Unknown User"}</h2>
                            {(() => {
                                const normalizedRole = normalizeRoleValue(selected.orgRole ?? selected.role);
                                const isProtectedRole = FIXED_ROLES.includes(normalizedRole);

                                return isProtectedRole ? (
                                <div className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg cursor-default border border-slate-200">
                                    <ShieldCheckIcon className="w-4 h-4 text-slate-400" />
                                    <span className="text-xs font-medium">Protected Role</span>
                                </div>
                                ) : null;
                            })()}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-sm text-slate-500">{selected.email}</span>
                          {selected.employeeId && (
                            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/10 font-mono">
                              #{selected.employeeId}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className={`px-3 py-1 rounded-full text-xs font-medium border ${
                          selected.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
                        }`}>
                          {selected.status === "active" ? "Active" : "Inactive"}
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setDossierOpen(true)}
                            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-indigo-100"
                          >
                            <IdentificationIcon className="w-4 h-4" />
                            View Dossier
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Role & Promotion */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                      <h3 className="text-sm font-semibold text-slate-900 mb-4">User Management</h3>
                      
                      {(() => {
                         const normalizedRole = normalizeRoleValue(selected.orgRole ?? selected.role);
                         const isFixedRole = FIXED_ROLES.includes(normalizedRole);
                         
                         if (isFixedRole) return (
                            <div className="mb-6 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
                                Role modification is disabled for <strong>{formatRoleLabel(selected.orgRole ?? selected.role)}</strong> accounts.
                            </div>
                         );

                         return (
                          <div className="mb-6">
                            <label className="block text-xs font-semibold text-slate-500">Organizational Role</label>
                            <select
                              className="mt-1 w-full rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                              value={selectedOrgRole}
                              onChange={(event) => setSelectedOrgRole(event.target.value)}
                            >
                              {ORG_ROLES.map((role) => (
                                <option key={role.value} value={role.value}>
                                  {role.label}
                                </option>
                              ))}
                            </select>
                            <div className="mt-2 text-[11px] text-slate-500">
                              Choose the base role. Temporary acting-role overrides can be configured below with an expiry.
                            </div>
                          </div>
                         );
                      })()}
                      
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                           <label className="text-xs font-semibold text-slate-500">Reports To</label>
                            <select
                              className="w-full mt-1 rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                              value={reportsTo}
                              onChange={(e) => setReportsTo(e.target.value)}
                            >
                              <option value="">â€” No Supervisor â€”</option>
                              {[ 
                                ...supervisors, 
                                ...(additionalSupervisor && !supervisors.find(s => s.uid === additionalSupervisor.uid) ? [additionalSupervisor] : [])
                              ].filter(u => u.uid !== selected.uid).map((u) => (
                                <option key={u.uid} value={u.uid}>
                                  {formatSupervisorLabel(u)}
                                </option>
                              ))}
                            </select>
                        </div>
                        <div>
                           <label className="text-xs font-semibold text-slate-500">Assigned HR</label>
                            <select
                              className="w-full mt-1 rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                              value={assignedHR}
                              onChange={(e) => setAssignedHR(e.target.value)}
                            >
                              <option value="">â€” No HR Assigned â€”</option>
                              {hrUsers.map((u) => (
                                <option key={u.uid} value={u.uid}>
                                  {formatSupervisorLabel(u)}
                                </option>
                              ))}
                            </select>
                        </div>
                        <div>
                           <label className="text-xs font-semibold text-slate-500">Reporting Mode</label>
                           <div className="mt-1 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                            <button
                              type="button"
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                reportingMode === "permanent"
                                  ? "bg-indigo-600 text-white"
                                  : "text-slate-600 hover:bg-white"
                              }`}
                              onClick={() => setReportingMode("permanent")}
                            >
                              Permanent
                            </button>
                            <button
                              type="button"
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                reportingMode === "temporary"
                                  ? "bg-indigo-600 text-white"
                                  : "text-slate-600 hover:bg-white"
                              }`}
                              onClick={() => setReportingMode("temporary")}
                            >
                              Temporary
                            </button>
                           </div>
                        </div>
                        <div>
                           <label className="text-xs font-semibold text-slate-500">Acting Role Mode</label>
                           <div className="mt-1 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                            <button
                              type="button"
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                actingMode === "permanent"
                                  ? "bg-indigo-600 text-white"
                                  : "text-slate-600 hover:bg-white"
                              }`}
                              onClick={() => setActingMode("permanent")}
                            >
                              Permanent
                            </button>
                            <button
                              type="button"
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                actingMode === "temporary"
                                  ? "bg-indigo-600 text-white"
                                  : "text-slate-600 hover:bg-white"
                              }`}
                              onClick={() => setActingMode("temporary")}
                            >
                              Temporary
                            </button>
                           </div>
                        </div>
                        {reportingMode === "temporary" ? (
                          <>
                            <div>
                               <label className="text-xs font-semibold text-slate-500">Temporary Reports To</label>
                                <select
                                  className="w-full mt-1 rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                                  value={temporaryReportsTo}
                                  onChange={(e) => setTemporaryReportsTo(e.target.value)}
                                >
                                  <option value="">Select temporary supervisor</option>
                                  {[
                                    ...supervisors,
                                    ...(additionalSupervisor && !supervisors.find((s) => s.uid === additionalSupervisor.uid) ? [additionalSupervisor] : []),
                                  ].filter((u) => u.uid !== selected.uid).map((u) => (
                                    <option key={u.uid} value={u.uid}>
                                      {formatSupervisorLabel(u)}
                                    </option>
                                  ))}
                                </select>
                            </div>
                            <div>
                               <label className="text-xs font-semibold text-slate-500">Temporary Reporting Until</label>
                                <input
                                  type="datetime-local"
                                  className="w-full mt-1 rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                                  value={temporaryReportsToUntil}
                                  onChange={(e) => setTemporaryReportsToUntil(e.target.value)}
                                />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="text-xs font-semibold text-slate-500">Temporary Reporting Reason</label>
                              <textarea
                                rows={3}
                                className="mt-1 w-full rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                                value={temporaryReportsToReason}
                                onChange={(event) => setTemporaryReportsToReason(event.target.value)}
                                placeholder="Example: manager on leave, interim reassignment, attrition coverage."
                              />
                            </div>
                          </>
                        ) : (
                          <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                            Permanent reporting is active. Set mode to <strong>Temporary</strong> to apply interim reporting with reason and expiry.
                          </div>
                        )}
                        {actingMode === "temporary" ? (
                          <>
                            <div>
                               <label className="text-xs font-semibold text-slate-500">Acting Role</label>
                                <select
                                  className="w-full mt-1 rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                                  value={actingOrgRole}
                                  onChange={(e) => setActingOrgRole(e.target.value)}
                                >
                                  <option value="">Select acting role</option>
                                  {SALES_ROLE_OPTIONS.filter((role) => getSalesHierarchyRank(role.value) >= getSalesHierarchyRank("TEAM_LEAD")).map((role) => (
                                    <option key={role.value} value={role.value}>
                                      {role.label}
                                    </option>
                                  ))}
                                </select>
                            </div>
                            <div>
                               <label className="text-xs font-semibold text-slate-500">Acting Role Until</label>
                                <input
                                  type="datetime-local"
                                  className="w-full mt-1 rounded-lg border-slate-200 bg-white px-3 py-2 text-sm"
                                  value={actingRoleUntil}
                                  onChange={(e) => setActingRoleUntil(e.target.value)}
                                />
                            </div>
                          </>
                        ) : (
                          <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                            No temporary acting-role override. Base organizational role remains active.
                          </div>
                        )}
                      </div>

                      {saveMessage ? (
                        <div
                          className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
                            saveMessage.type === "success"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-rose-200 bg-rose-50 text-rose-700"
                          }`}
                        >
                          {saveMessage.text}
                        </div>
                      ) : null}



                      <div className="mt-6 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void applyChanges()}
                          disabled={saving}
                          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                        >
                          <CheckCircleIcon className="h-4 w-4" />
                          {saving ? "Savingâ€¦" : "Apply Changes"}
                        </button>
                      </div>
                    </div>

                    {/* Lifecycle Zone */}
                    <div className="rounded-2xl border border-red-100 bg-red-50/50 p-6">
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-900">
                        <ExclamationTriangleIcon className="h-4 w-4" />
                        Lifecycle Control
                      </h3>
                      {!showLifecycle ? (
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-red-700">
                            Deactivate, set temporary inactivity, or terminate while preserving employee records.
                          </p>
                          <button
                            onClick={() => {
                              setShowLifecycle(true);
                              setLifecycleAction("deactivate");
                              setLifecycleReason("");
                              setInactiveUntil("");
                              setLifecycleConfirm("");
                            }}
                            className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-red-600 shadow-sm ring-1 ring-inset ring-red-200 hover:bg-red-50"
                          >
                            Manage Lifecycle
                          </button>
                        </div>
                      ) : (
                        <div className="animate-in space-y-4 fade-in zoom-in-95 duration-200">
                          <p className="text-sm font-medium text-red-800">
                            Apply lifecycle action for <strong>{selected.displayName}</strong>.
                          </p>
                          <div className="space-y-2">
                            <label className="text-xs font-semibold text-red-700">Action</label>
                            <select
                              className="w-full rounded-lg border-red-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:ring-red-500"
                              value={lifecycleAction}
                              onChange={(event) =>
                                setLifecycleAction(event.target.value as "deactivate" | "inactive_till" | "terminate")
                              }
                            >
                              <option value="deactivate">Deactivate</option>
                              <option value="inactive_till">Inactive till date</option>
                              <option value="terminate">Terminate</option>
                            </select>
                          </div>
                          {lifecycleAction === "inactive_till" ? (
                            <div className="space-y-2">
                              <label className="text-xs font-semibold text-red-700">Inactive till</label>
                              <input
                                type="datetime-local"
                                className="w-full rounded-lg border-red-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:ring-red-500"
                                value={inactiveUntil}
                                onChange={(event) => setInactiveUntil(event.target.value)}
                              />
                            </div>
                          ) : null}
                          <div className="space-y-2">
                            <label className="text-xs font-semibold text-red-700">Reason</label>
                            <textarea
                              rows={3}
                              className="w-full rounded-lg border-red-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:ring-red-500"
                              value={lifecycleReason}
                              onChange={(event) => setLifecycleReason(event.target.value)}
                              placeholder="State why this lifecycle action is being applied."
                            />
                          </div>
                          <div className="space-y-1 rounded-lg border border-red-100 bg-white p-3 text-xs text-red-600">
                            <div>- Employee profile remains preserved and searchable.</div>
                            <div>- Access is disabled while status is inactive or terminated.</div>
                            <div>- Deactivate/terminate auto-transfer active leads to manager with custody timeline.</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <input
                              type="text"
                              placeholder='Type "confirm" to apply'
                              className="flex-1 rounded-lg border-red-200 text-sm focus:border-red-500 focus:ring-red-500"
                              value={lifecycleConfirm}
                              onChange={(event) => setLifecycleConfirm(event.target.value)}
                            />
                            <button
                              onClick={() => void handleLifecycleAction()}
                              disabled={
                                lifecycleConfirm !== "confirm" ||
                                saving ||
                                !lifecycleReason.trim() ||
                                (lifecycleAction === "inactive_till" && !inactiveUntil)
                              }
                              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                            >
                              Apply Action
                            </button>
                            <button
                              onClick={() => setShowLifecycle(false)}
                              className="text-xs text-red-600 underline"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Dossier Modal */}
      <EmployeeDossierModal
        isOpen={dossierOpen}
        onClose={() => setDossierOpen(false)}
        employeeId={selected?.uid || null}
      />

    </AuthGate>
  );
}


