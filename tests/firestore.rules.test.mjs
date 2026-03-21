import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const projectId = "demo-people-rules";
const now = new Date("2026-02-28T00:00:00.000Z");

let testEnv;

function authedDb(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seedBaseData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      setDoc(doc(db, "users", "superadmin1"), {
        uid: "superadmin1",
        email: "superadmin@example.com",
        displayName: "Super Admin",
        role: "admin",
        orgRole: "SUPER_ADMIN",
        status: "active",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "admin1"), {
        uid: "admin1",
        email: "admin@example.com",
        displayName: "Admin",
        role: "admin",
        orgRole: "ADMIN",
        status: "active",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "seniormanager1"), {
        uid: "seniormanager1",
        email: "seniormanager@example.com",
        displayName: "Senior Manager One",
        role: "SENIOR_MANAGER",
        orgRole: "SENIOR_MANAGER",
        status: "active",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "manager1"), {
        uid: "manager1",
        email: "manager1@example.com",
        displayName: "Manager One",
        role: "manager",
        orgRole: "MANAGER",
        status: "active",
        reportsTo: "seniormanager1",
        managerId: "seniormanager1",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "manager2"), {
        uid: "manager2",
        email: "manager2@example.com",
        displayName: "Manager Two",
        role: "manager",
        orgRole: "MANAGER",
        status: "active",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "teamlead1"), {
        uid: "teamlead1",
        email: "teamlead1@example.com",
        displayName: "Team Lead",
        role: "teamLead",
        orgRole: "TEAM_LEAD",
        status: "active",
        reportsTo: "manager1",
        managerId: "manager1",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "employee1"), {
        uid: "employee1",
        email: "employee1@example.com",
        displayName: "Employee One",
        role: "employee",
        orgRole: "EMPLOYEE",
        status: "active",
        reportsTo: "manager1",
        managerId: "manager1",
        teamLeadId: "teamlead1",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "employee2"), {
        uid: "employee2",
        email: "employee2@example.com",
        displayName: "Employee Two",
        role: "employee",
        orgRole: "EMPLOYEE",
        status: "active",
        reportsTo: "manager2",
        managerId: "manager2",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "bda1"), {
        uid: "bda1",
        email: "bda1@example.com",
        displayName: "BDA One",
        role: "BDA",
        orgRole: "BDA",
        status: "active",
        reportsTo: "manager1",
        managerId: "manager1",
        teamLeadId: "teamlead1",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "hr1"), {
        uid: "hr1",
        email: "hr@example.com",
        displayName: "HR User",
        role: "HR",
        orgRole: "HR",
        status: "active",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "financer1"), {
        uid: "financer1",
        email: "financer@example.com",
        displayName: "Financer",
        role: "financer",
        orgRole: "FINANCER",
        status: "active",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "ceo1"), {
        uid: "ceo1",
        email: "ceo@example.com",
        displayName: "CEO One",
        role: "CEO",
        orgRole: "CEO",
        status: "active",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "cbo1"), {
        uid: "cbo1",
        email: "cbo@example.com",
        displayName: "CBO One",
        role: "CBO",
        orgRole: "CBO",
        status: "active",
        reportsTo: "ceo1",
        managerId: "ceo1",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "saleshead1"), {
        uid: "saleshead1",
        email: "saleshead@example.com",
        displayName: "Sales Head One",
        role: "SALES_HEAD",
        orgRole: "SALES_HEAD",
        status: "active",
        reportsTo: "cbo1",
        managerId: "cbo1",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "vp1"), {
        uid: "vp1",
        email: "vp@example.com",
        displayName: "VP One",
        role: "VP",
        orgRole: "VP",
        status: "active",
        reportsTo: "saleshead1",
        managerId: "saleshead1",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "avp1"), {
        uid: "avp1",
        email: "avp@example.com",
        displayName: "AVP One",
        role: "AVP",
        orgRole: "AVP",
        status: "active",
        reportsTo: "vp1",
        managerId: "vp1",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "gm1"), {
        uid: "gm1",
        email: "gm@example.com",
        displayName: "GM One",
        role: "GM",
        orgRole: "GM",
        status: "active",
        reportsTo: "avp1",
        managerId: "avp1",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "seniormanager2"), {
        uid: "seniormanager2",
        email: "seniormanager2@example.com",
        displayName: "Senior Manager Two",
        role: "SENIOR_MANAGER",
        orgRole: "SENIOR_MANAGER",
        status: "active",
        reportsTo: "gm1",
        managerId: "gm1",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "managerDeep"), {
        uid: "managerDeep",
        email: "managerdeep@example.com",
        displayName: "Manager Deep",
        role: "manager",
        orgRole: "MANAGER",
        status: "active",
        reportsTo: "seniormanager2",
        managerId: "seniormanager2",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "teamleadDeep"), {
        uid: "teamleadDeep",
        email: "teamleaddeep@example.com",
        displayName: "Team Lead Deep",
        role: "teamLead",
        orgRole: "TEAM_LEAD",
        status: "active",
        reportsTo: "managerDeep",
        managerId: "managerDeep",
        teamLeadId: null,
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "bdaDeep"), {
        uid: "bdaDeep",
        email: "bdadeep@example.com",
        displayName: "BDA Deep",
        role: "BDA",
        orgRole: "BDA",
        status: "active",
        reportsTo: "managerDeep",
        managerId: "managerDeep",
        teamLeadId: "teamleadDeep",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "employeeTemp"), {
        uid: "employeeTemp",
        email: "employeetemp@example.com",
        displayName: "Employee Temporary Scope",
        role: "employee",
        orgRole: "EMPLOYEE",
        status: "active",
        reportsTo: "manager2",
        managerId: "manager2",
        teamLeadId: null,
        temporaryReportsTo: "manager1",
        temporaryReportsToUntil: new Date("2026-03-15T00:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "employeeTempExpired"), {
        uid: "employeeTempExpired",
        email: "employeetempexpired@example.com",
        displayName: "Employee Temporary Scope Expired",
        role: "employee",
        orgRole: "EMPLOYEE",
        status: "active",
        reportsTo: "manager2",
        managerId: "manager2",
        teamLeadId: null,
        temporaryReportsTo: "manager1",
        temporaryReportsToUntil: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "users", "employee1", "private_data", "keys"), {
        encryptedPrivateKey: "secret-1",
      }),
      setDoc(doc(db, "users", "employee2", "private_data", "keys"), {
        encryptedPrivateKey: "secret-2",
      }),
      setDoc(doc(db, "leads", "lead-assigned"), {
        leadId: "lead-assigned",
        name: "Assigned Lead",
        assignedTo: "employee1",
        ownerUid: "employee1",
        status: "new",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "leads", "lead-unassigned"), {
        leadId: "lead-unassigned",
        name: "Unassigned Lead",
        assignedTo: null,
        ownerUid: null,
        status: "new",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "leads", "lead-bda-owned"), {
        leadId: "lead-bda-owned",
        name: "BDA Owned Lead",
        assignedTo: "bda1",
        ownerUid: "bda1",
        status: "followup",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "leads", "lead-deep-owned"), {
        leadId: "lead-deep-owned",
        name: "Deep Chain Lead",
        assignedTo: "bdaDeep",
        ownerUid: "bdaDeep",
        status: "new",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "leads", "lead-temp-owned"), {
        leadId: "lead-temp-owned",
        name: "Temporary Reporting Lead",
        assignedTo: "employeeTemp",
        ownerUid: "employeeTemp",
        status: "new",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "leads", "lead-temp-expired-owned"), {
        leadId: "lead-temp-expired-owned",
        name: "Expired Temporary Reporting Lead",
        assignedTo: "employeeTempExpired",
        ownerUid: "employeeTempExpired",
        status: "new",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "leads", "lead-assigned", "timeline", "event-1"), {
        type: "status_updated",
        summary: "Lead moved to follow up",
        actor: {
          uid: "employee1",
          name: "Employee One",
          role: "EMPLOYEE",
        },
        createdAt: now,
      }),
      setDoc(doc(db, "leads", "lead-assigned", "activities", "activity-1"), {
        type: "call_connected",
        channel: "call",
        summary: "Initial conversation completed",
        note: "Lead asked for a callback after work hours",
        happenedAt: now,
        followUpAt: null,
        relatedStatus: "followup",
        actor: {
          uid: "employee1",
          name: "Employee One",
          role: "EMPLOYEE",
        },
        metadata: {},
        createdAt: now,
      }),
      setDoc(doc(db, "leads", "lead-assigned", "notes", "note-1"), {
        body: "Asked to call back after 5 PM",
        author: {
          uid: "employee1",
          name: "Employee One",
          role: "EMPLOYEE",
        },
        createdAt: now,
      }),
      setDoc(doc(db, "leads", "lead-assigned", "documents", "doc-1"), {
        title: "Fee Sheet",
        url: "https://example.com/fee-sheet",
        category: "Fee Quote",
        uploadedBy: {
          uid: "employee1",
          name: "Employee One",
          role: "EMPLOYEE",
        },
        createdAt: now,
      }),
      setDoc(doc(db, "tasks", "task-1"), {
        id: "task-1",
        title: "Call lead",
        assignedTo: "employee1",
        assigneeUid: "employee1",
        assignedBy: "manager1",
        createdBy: "manager1",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "notifications", "note-1"), {
        recipientUid: "employee1",
        message: "Follow up",
        createdAt: now,
      }),
      setDoc(doc(db, "crm_smart_views", "view-personal"), {
        id: "view-personal",
        name: "Personal Queue",
        ownerUid: "employee1",
        ownerName: "Employee One",
        baseTabId: "due_today",
        filters: {
          searchTerm: "loan",
          status: "followup",
          ownerUid: "employee1",
        },
        pinned: true,
        isDefault: true,
        visibility: "personal",
        sharedWithUserUids: [],
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "crm_smart_views", "view-team"), {
        id: "view-team",
        name: "Manager Push",
        ownerUid: "manager1",
        ownerName: "Manager One",
        baseTabId: "no_activity_24h",
        filters: {
          searchTerm: "",
          status: "all",
          ownerUid: "all",
        },
        pinned: true,
        isDefault: false,
        visibility: "team_shared",
        sharedWithUserUids: ["employee1", "teamlead1"],
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "crm_bulk_actions", "batch-1"), {
        batchId: "batch-1",
        actor: {
          uid: "manager1",
          name: "Manager One",
          role: "MANAGER",
        },
        summary: "Bulk stale lead recovery run",
        state: "completed_with_issues",
        requested: 10,
        updated: 8,
        writeFailureCount: 1,
        sideEffectFailureCount: 1,
        startedAt: now,
        completedAt: now,
      }),
      setDoc(doc(db, "crm_bulk_actions", "batch-1", "lead_changes", "change-1"), {
        leadId: "lead-assigned",
        summary: "owner updated",
        before: {
          ownerUid: "employee1",
          status: "new",
        },
        after: {
          ownerUid: "teamlead1",
          status: "followup",
        },
        createdAt: now,
      }),
      setDoc(doc(db, "crm_bulk_actions", "batch-1", "lead_failures", "failure-1"), {
        leadId: "lead-unassigned",
        step: "workflow_sync",
        error: "Unable to sync workflow automation.",
        createdAt: now,
      }),
      setDoc(doc(db, "crm_import_batches", "import-batch-1"), {
        batchId: "import-batch-1",
        fileName: "March_Leads.xlsx",
        sourceTag: "Meta Ads",
        tags: ["March", "North Zone"],
        tagsNormalized: ["march", "north zone"],
        status: "completed",
        totalRows: 120,
        eligibleRows: 115,
        importedRows: 115,
        skippedRows: 5,
        duplicateFlaggedRows: 7,
        createdByUid: "manager1",
        createdByName: "Manager One",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "bda_pip_cases", "pip_bda1_1"), {
        id: "pip_bda1_1",
        bdaUid: "bda1",
        bdaName: "BDA One",
        managerUid: "manager1",
        managerName: "Manager One",
        triggerStatus: "missed",
        triggerCycleIndex: 1,
        triggerCycleLabel: "03/02 - 16/02",
        pipCycleIndex: 2,
        pipCycleLabel: "17/02 - 02/03",
        pipTargetSales: 2,
        pipAchievedSales: 0,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "bda_counselling_entries", "entry-1"), {
        id: "entry-1",
        bdaUid: "bda1",
        bdaName: "BDA One",
        managerUid: "manager1",
        managerName: "Manager One",
        cycleIndex: 2,
        cycleLabel: "17/02 - 02/03",
        entryDateKey: "2026-02-28",
        counsellingCount: 4,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "finance_external_accounts", "account-1"), {
        accountHolderName: "Vendor One",
        createdAt: now,
      }),
      setDoc(doc(db, "payroll", "payroll-1"), {
        uid: "employee1",
        month: "2026-02",
        status: "GENERATED",
        createdAt: now,
      }),
      setDoc(doc(db, "finance_approval_requests", "request-1"), {
        action: "CREATE_TRANSACTION",
        status: "PENDING",
        summary: "Debit of Rs 10,000 for Salaries",
        requestedBy: {
          uid: "financer1",
          name: "Financer",
          role: "FINANCER",
        },
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "finance_audit_events", "event-1"), {
        eventType: "approval_requested",
        action: "FINANCE_APPROVAL_REQUESTED",
        summary: "Debit of Rs 10,000 for Salaries",
        actor: {
          uid: "financer1",
          name: "Financer",
          role: "FINANCER",
        },
        createdAt: now,
      }),
      setDoc(doc(db, "employees", "employee1"), {
        email: "employee1@example.com",
        role: "employee",
        status: "active",
        teamLeadId: "teamlead1",
        createdAt: now,
        updatedAt: now,
      }),
      setDoc(doc(db, "employee_lifecycle_audit", "lifecycle-1"), {
        id: "lifecycle-1",
        targetUid: "employee1",
        action: "inactive_till",
        actor: {
          uid: "manager1",
          role: "MANAGER",
        },
        reason: "Test lifecycle",
        createdAt: now,
      }),
      setDoc(doc(db, "users", "employee1", "lifecycle_audit", "lifecycle-1"), {
        id: "lifecycle-1",
        targetUid: "employee1",
        action: "inactive_till",
        actor: {
          uid: "manager1",
          role: "MANAGER",
        },
        reason: "Test lifecycle",
        createdAt: now,
      }),
      setDoc(doc(db, "crm_whatsapp_ingest_events", "wa-1"), {
        source: "whatsapp",
        leadId: "lead-bda-owned",
        phone: "919999999999",
        createdAt: now,
      }),
      setDoc(doc(db, "settings", "sales_targets"), {
        "2026-02": 1200000,
        updatedAt: now,
      }),
      setDoc(doc(db, "presence", "employee1"), {
        uid: "employee1",
        status: "checked_in",
        checkedInAt: now,
      }),
      setDoc(
        doc(db, "users", "employee1", "attendance", "2026", "months", "02", "days", "2026-02-28"),
        {
          uid: "employee1",
          userId: "employee1",
          dateKey: "2026-02-28",
          status: "checked_in",
          dayStatus: "present",
          checkedInAt: now,
          updatedAt: now,
        },
      ),
    ]);
  });
}

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedBaseData();
});

after(async () => {
  await testEnv.cleanup();
});

test("denies anonymous reads on user profiles", async () => {
  await assertFails(getDoc(doc(anonDb(), "users", "employee1")));
});

test("allows any authenticated user to read user profiles", async () => {
  await assertSucceeds(getDoc(doc(authedDb("employee2"), "users", "employee1")));
});

test("limits private_data reads to the owning user", async () => {
  await assertSucceeds(
    getDoc(doc(authedDb("employee1"), "users", "employee1", "private_data", "keys")),
  );
  await assertFails(
    getDoc(doc(authedDb("employee2"), "users", "employee1", "private_data", "keys")),
  );
});

test("allows ADMIN to update employee role/orgRole", async () => {
  await assertSucceeds(
    updateDoc(doc(authedDb("admin1"), "users", "employee1"), {
      role: "manager",
      orgRole: "MANAGER",
      updatedAt: now,
    }),
  );
});

test("allows authenticated reads on employees registry and restricts writes to management roles", async () => {
  await assertSucceeds(getDoc(doc(authedDb("employee1"), "employees", "employee1")));
  await assertSucceeds(
    updateDoc(doc(authedDb("manager1"), "employees", "employee1"), {
      status: "inactive",
      updatedAt: now,
    }),
  );
  await assertFails(
    updateDoc(doc(authedDb("employee1"), "employees", "employee1"), {
      status: "inactive",
      updatedAt: now,
    }),
  );
});

test("allows scoped lifecycle audit visibility and keeps lifecycle records immutable", async () => {
  await assertSucceeds(getDoc(doc(authedDb("manager1"), "employee_lifecycle_audit", "lifecycle-1")));
  await assertSucceeds(
    getDoc(doc(authedDb("employee1"), "users", "employee1", "lifecycle_audit", "lifecycle-1")),
  );
  await assertFails(
    getDoc(doc(authedDb("employee2"), "users", "employee1", "lifecycle_audit", "lifecycle-1")),
  );
  await assertFails(
    updateDoc(doc(authedDb("manager1"), "employee_lifecycle_audit", "lifecycle-1"), {
      reason: "tamper",
      updatedAt: now,
    }),
  );
});

test("allows management read access to WhatsApp ingest logs and blocks individual contributors", async () => {
  await assertSucceeds(getDoc(doc(authedDb("manager1"), "crm_whatsapp_ingest_events", "wa-1")));
  await assertFails(getDoc(doc(authedDb("employee1"), "crm_whatsapp_ingest_events", "wa-1")));
});

test("denies non-admin non-hr non-superadmin from updating unrelated user profile", async () => {
  await assertFails(
    updateDoc(doc(authedDb("employee2"), "users", "employee1"), {
      role: "manager",
      orgRole: "MANAGER",
      updatedAt: now,
    }),
  );
});

test("allows any authenticated user to read leads under current additive rules", async () => {
  const snap = await assertSucceeds(getDoc(doc(authedDb("employee2"), "leads", "lead-assigned")));
  assert.equal(snap.exists(), true);
});

test("allows assignees to update their own leads", async () => {
  await assertSucceeds(
    updateDoc(doc(authedDb("employee1"), "leads", "lead-assigned"), {
      remarks: "Called back",
      updatedAt: now,
    }),
  );
});

test("denies BDAs from changing lead ownership fields", async () => {
  await assertFails(
    updateDoc(doc(authedDb("bda1"), "leads", "lead-bda-owned"), {
      assignedTo: "employee1",
      ownerUid: "employee1",
      updatedAt: now,
    }),
  );
});

test("denies BDA lead create when trying to assign another user", async () => {
  await assertFails(
    setDoc(doc(authedDb("bda1"), "leads", "lead-bda-create-denied"), {
      leadId: "lead-bda-create-denied",
      name: "BDA Invalid Assignment",
      assignedTo: "employee1",
      ownerUid: "employee1",
      status: "new",
      createdAt: now,
      updatedAt: now,
    }),
  );
});

test("allows BDA lead create when ownership stays with self", async () => {
  await assertSucceeds(
    setDoc(doc(authedDb("bda1"), "leads", "lead-bda-create-self"), {
      leadId: "lead-bda-create-self",
      name: "BDA Self Assignment",
      assignedTo: "bda1",
      ownerUid: "bda1",
      status: "new",
      createdAt: now,
      updatedAt: now,
    }),
  );
});

test("allows manager lead create for scoped subordinate ownership", async () => {
  await assertSucceeds(
    setDoc(doc(authedDb("manager1"), "leads", "lead-manager-create-scope"), {
      leadId: "lead-manager-create-scope",
      name: "Manager Scoped Assignment",
      assignedTo: "employee1",
      ownerUid: "employee1",
      status: "new",
      createdAt: now,
      updatedAt: now,
    }),
  );
});

test("allows manager-and-above roles to reassign ownership inside scope", async () => {
  await assertSucceeds(
    updateDoc(doc(authedDb("manager1"), "leads", "lead-bda-owned"), {
      assignedTo: "employee1",
      ownerUid: "employee1",
      assignedBy: "manager1",
      updatedAt: now,
    }),
  );
});

test("allows extended hierarchy leadership to manage deep-reporting leads", async () => {
  await assertSucceeds(
    updateDoc(doc(authedDb("gm1"), "leads", "lead-deep-owned"), {
      assignedTo: "managerDeep",
      ownerUid: "managerDeep",
      assignedBy: "gm1",
      updatedAt: now,
    }),
  );

  await assertFails(
    updateDoc(doc(authedDb("employee2"), "leads", "lead-deep-owned"), {
      assignedTo: "employee2",
      ownerUid: "employee2",
      updatedAt: now,
    }),
  );
});

test("keeps manager transfers enabled while non-managers stay blocked", async () => {
  await assertSucceeds(
    updateDoc(doc(authedDb("manager1"), "leads", "lead-temp-owned"), {
      assignedTo: "employee1",
      ownerUid: "employee1",
      updatedAt: now,
    }),
  );

  await assertFails(
    updateDoc(doc(authedDb("employee2"), "leads", "lead-temp-expired-owned"), {
      assignedTo: "employee1",
      ownerUid: "employee1",
      updatedAt: now,
    }),
  );
});

test("denies unrelated users from updating assigned leads", async () => {
  await assertFails(
    updateDoc(doc(authedDb("employee2"), "leads", "lead-assigned"), {
      remarks: "Should fail",
      updatedAt: now,
    }),
  );
});

test("allows managers to update unassigned leads", async () => {
  await assertSucceeds(
    updateDoc(doc(authedDb("manager1"), "leads", "lead-unassigned"), {
      assignedTo: "employee1",
      ownerUid: "employee1",
      updatedAt: now,
    }),
  );
});

test("allows manager attendance override writes for direct reports and denies team-lead write overrides", async () => {
  await assertSucceeds(
    updateDoc(
      doc(authedDb("manager1"), "users", "employee1", "attendance", "2026", "months", "02", "days", "2026-02-28"),
      {
        status: "absent",
        dayStatus: "absent",
        correctionStatus: "pending_hr_review",
        correctionReason: "Marked absent after missed shift",
        updatedAt: now,
      },
    ),
  );

  await assertFails(
    updateDoc(
      doc(authedDb("teamlead1"), "users", "employee1", "attendance", "2026", "months", "02", "days", "2026-02-28"),
      {
        dayStatus: "absent",
        updatedAt: now,
      },
    ),
  );
});

test("allows HR to approve attendance corrections and keeps attendance override audit immutable", async () => {
  await assertSucceeds(
    setDoc(doc(authedDb("manager1"), "attendance_override_audit", "audit-1"), {
      uid: "employee1",
      dateKey: "2026-02-28",
      reason: "No response during shift",
      correctionStatus: "pending_hr_review",
      actor: {
        uid: "manager1",
        role: "MANAGER",
      },
      createdAt: now,
    }),
  );

  await assertSucceeds(
    updateDoc(
      doc(authedDb("hr1"), "users", "employee1", "attendance", "2026", "months", "02", "days", "2026-02-28"),
      {
        correctionStatus: "approved",
        correctionReviewReason: "Validated with manager notes",
        updatedAt: now,
      },
    ),
  );

  await assertFails(
    setDoc(doc(authedDb("bda1"), "attendance_override_audit", "audit-bda"), {
      uid: "employee1",
      dateKey: "2026-02-28",
      reason: "tamper",
      correctionStatus: "pending_hr_review",
      actor: {
        uid: "bda1",
        role: "BDA",
      },
      createdAt: now,
    }),
  );

  await assertFails(
    updateDoc(doc(authedDb("manager1"), "attendance_override_audit", "audit-1"), {
      reason: "tamper",
      updatedAt: now,
    }),
  );
});

test("allows authenticated timeline reads and create-only writes for lead events", async () => {
  await assertSucceeds(
    getDoc(doc(authedDb("employee2"), "leads", "lead-assigned", "timeline", "event-1")),
  );
  await assertSucceeds(
    setDoc(doc(authedDb("employee1"), "leads", "lead-assigned", "timeline", "event-2"), {
      type: "details_updated",
      summary: "Lead details updated",
      actor: {
        uid: "employee1",
        name: "Employee One",
        role: "EMPLOYEE",
      },
      createdAt: now,
    }),
  );
  await assertFails(
    updateDoc(doc(authedDb("employee1"), "leads", "lead-assigned", "timeline", "event-1"), {
      summary: "tamper",
    }),
  );
});

test("allows authenticated note and document creation but keeps them immutable", async () => {
  await assertSucceeds(
    getDoc(doc(authedDb("employee2"), "leads", "lead-assigned", "notes", "note-1")),
  );
  await assertSucceeds(
    setDoc(doc(authedDb("employee1"), "leads", "lead-assigned", "notes", "note-2"), {
      body: "Parent requested callback tomorrow",
      author: {
        uid: "employee1",
        name: "Employee One",
        role: "EMPLOYEE",
      },
      createdAt: now,
    }),
  );
  await assertFails(
    updateDoc(doc(authedDb("employee1"), "leads", "lead-assigned", "notes", "note-1"), {
      body: "tamper",
    }),
  );

  await assertSucceeds(
    getDoc(doc(authedDb("employee2"), "leads", "lead-assigned", "documents", "doc-1")),
  );
  await assertSucceeds(
    setDoc(doc(authedDb("employee1"), "leads", "lead-assigned", "documents", "doc-2"), {
      title: "Application Form",
      url: "https://example.com/application-form",
      category: "Application",
      uploadedBy: {
        uid: "employee1",
        name: "Employee One",
        role: "EMPLOYEE",
      },
      createdAt: now,
    }),
  );
  await assertFails(
    updateDoc(doc(authedDb("employee1"), "leads", "lead-assigned", "documents", "doc-1"), {
      title: "tamper",
    }),
  );
});

test("allows authenticated structured activity creation but keeps activities immutable", async () => {
  await assertSucceeds(
    getDoc(doc(authedDb("employee2"), "leads", "lead-assigned", "activities", "activity-1")),
  );
  await assertSucceeds(
    setDoc(doc(authedDb("employee1"), "leads", "lead-assigned", "activities", "activity-2"), {
      type: "payment_reminder",
      channel: "payment",
      summary: "Payment reminder sent",
      note: "Shared the fee deadline on WhatsApp",
      happenedAt: now,
      followUpAt: now,
      relatedStatus: "payment_follow_up",
      actor: {
        uid: "employee1",
        name: "Employee One",
        role: "EMPLOYEE",
      },
      metadata: {},
      createdAt: now,
    }),
  );
  await assertFails(
    updateDoc(doc(authedDb("employee1"), "leads", "lead-assigned", "activities", "activity-1"), {
      summary: "tamper",
    }),
  );
});

test("allows task updates for assignees and creators but denies unrelated users", async () => {
  await assertSucceeds(
    updateDoc(doc(authedDb("employee1"), "tasks", "task-1"), {
      status: "in_progress",
      updatedAt: now,
    }),
  );
  await assertSucceeds(
    updateDoc(doc(authedDb("manager1"), "tasks", "task-1"), {
      status: "completed",
      updatedAt: now,
    }),
  );
  await assertSucceeds(
    updateDoc(doc(authedDb("seniormanager1"), "tasks", "task-1"), {
      status: "review",
      updatedAt: now,
    }),
  );
  await assertFails(
    updateDoc(doc(authedDb("employee2"), "tasks", "task-1"), {
      status: "completed",
      updatedAt: now,
    }),
  );
});

test("limits notifications to the intended recipient", async () => {
  await assertSucceeds(getDoc(doc(authedDb("employee1"), "notifications", "note-1")));
  await assertFails(getDoc(doc(authedDb("employee2"), "notifications", "note-1")));
});

test("allows authenticated reads of settings targets but restricts writes to admin roles", async () => {
  await assertSucceeds(getDoc(doc(authedDb("employee1"), "settings", "sales_targets")));

  await assertSucceeds(
    updateDoc(doc(authedDb("admin1"), "settings", "sales_targets"), {
      "2026-03": 1500000,
      updatedAt: now,
    }),
  );

  await assertSucceeds(
    updateDoc(doc(authedDb("superadmin1"), "settings", "sales_targets"), {
      "2026-04": 1750000,
      updatedAt: now,
    }),
  );

  await assertFails(
    updateDoc(doc(authedDb("employee1"), "settings", "sales_targets"), {
      "2026-05": 900000,
      updatedAt: now,
    }),
  );
});

test("allows owners and shared recipients to read CRM smart views", async () => {
  await assertSucceeds(getDoc(doc(authedDb("employee1"), "crm_smart_views", "view-personal")));
  await assertSucceeds(getDoc(doc(authedDb("employee1"), "crm_smart_views", "view-team")));
  await assertFails(getDoc(doc(authedDb("employee2"), "crm_smart_views", "view-team")));
});

test("allows owners to create and update CRM smart views but blocks unrelated users", async () => {
  await assertSucceeds(
    setDoc(doc(authedDb("employee1"), "crm_smart_views", "view-new"), {
      id: "view-new",
      name: "BDA Priority Queue",
      ownerUid: "employee1",
      baseTabId: "new_leads",
      filters: {
        searchTerm: "",
        status: "new",
        ownerUid: "employee1",
      },
      pinned: true,
      isDefault: false,
      visibility: "personal",
      sharedWithUserUids: [],
      createdAt: now,
      updatedAt: now,
    }),
  );
  await assertSucceeds(
    updateDoc(doc(authedDb("employee1"), "crm_smart_views", "view-personal"), {
      name: "Personal Queue Updated",
      updatedAt: now,
    }),
  );
  await assertFails(
    updateDoc(doc(authedDb("employee2"), "crm_smart_views", "view-personal"), {
      name: "tamper",
      updatedAt: now,
    }),
  );
});

test("allows management roles to read CRM bulk execution logs and detail subcollections", async () => {
  await assertSucceeds(getDoc(doc(authedDb("manager1"), "crm_bulk_actions", "batch-1")));
  await assertSucceeds(
    getDoc(doc(authedDb("manager1"), "crm_bulk_actions", "batch-1", "lead_changes", "change-1")),
  );
  await assertSucceeds(
    getDoc(doc(authedDb("manager1"), "crm_bulk_actions", "batch-1", "lead_failures", "failure-1")),
  );

  await assertSucceeds(getDoc(doc(authedDb("teamlead1"), "crm_bulk_actions", "batch-1")));
  await assertSucceeds(
    getDoc(doc(authedDb("teamlead1"), "crm_bulk_actions", "batch-1", "lead_failures", "failure-1")),
  );
  await assertSucceeds(getDoc(doc(authedDb("seniormanager1"), "crm_bulk_actions", "batch-1")));
  await assertSucceeds(
    getDoc(doc(authedDb("seniormanager1"), "crm_bulk_actions", "batch-1", "lead_changes", "change-1")),
  );
});

test("denies non-management users from reading CRM bulk execution logs", async () => {
  await assertFails(getDoc(doc(authedDb("employee1"), "crm_bulk_actions", "batch-1")));
  await assertFails(
    getDoc(doc(authedDb("employee1"), "crm_bulk_actions", "batch-1", "lead_failures", "failure-1")),
  );
});

test("allows manager-and-above roles plus BDA to access CRM import batches", async () => {
  await assertSucceeds(getDoc(doc(authedDb("manager1"), "crm_import_batches", "import-batch-1")));
  await assertSucceeds(getDoc(doc(authedDb("admin1"), "crm_import_batches", "import-batch-1")));
  await assertSucceeds(getDoc(doc(authedDb("seniormanager1"), "crm_import_batches", "import-batch-1")));
  await assertSucceeds(getDoc(doc(authedDb("bda1"), "crm_import_batches", "import-batch-1")));

  await assertSucceeds(
    setDoc(doc(authedDb("manager1"), "crm_import_batches", "import-batch-2"), {
      batchId: "import-batch-2",
      sourceTag: "Counsellor Upload",
      tags: ["April"],
      createdByUid: "manager1",
      createdAt: now,
      updatedAt: now,
      status: "processing",
    }),
  );

  await assertSucceeds(
    updateDoc(doc(authedDb("manager1"), "crm_import_batches", "import-batch-2"), {
      status: "completed",
      updatedAt: now,
    }),
  );

  await assertSucceeds(
    setDoc(doc(authedDb("seniormanager1"), "crm_import_batches", "import-batch-3"), {
      batchId: "import-batch-3",
      sourceTag: "Senior Manager Upload",
      tags: ["May"],
      createdByUid: "seniormanager1",
      createdAt: now,
      updatedAt: now,
      status: "processing",
    }),
  );

  await assertSucceeds(
    setDoc(doc(authedDb("bda1"), "crm_import_batches", "import-batch-4"), {
      batchId: "import-batch-4",
      sourceTag: "BDA Upload",
      tags: ["June"],
      createdByUid: "bda1",
      createdAt: now,
      updatedAt: now,
      status: "processing",
    }),
  );

  await assertSucceeds(
    updateDoc(doc(authedDb("bda1"), "crm_import_batches", "import-batch-4"), {
      status: "completed",
      updatedAt: now,
    }),
  );
});

test("denies team-lead and employee access to CRM import batches", async () => {
  await assertFails(getDoc(doc(authedDb("teamlead1"), "crm_import_batches", "import-batch-1")));
  await assertFails(getDoc(doc(authedDb("employee1"), "crm_import_batches", "import-batch-1")));

  await assertFails(
    setDoc(doc(authedDb("teamlead1"), "crm_import_batches", "import-batch-denied"), {
      batchId: "import-batch-denied",
      sourceTag: "Denied",
      tags: ["Denied"],
      createdByUid: "teamlead1",
      createdAt: now,
      updatedAt: now,
      status: "processing",
    }),
  );
});

test("allows BDA self-create for counselling entries and blocks non-BDA self writes", async () => {
  await assertSucceeds(
    setDoc(doc(authedDb("bda1"), "bda_counselling_entries", "entry-self"), {
      id: "entry-self",
      bdaUid: "bda1",
      bdaName: "BDA One",
      managerUid: "manager1",
      managerName: "Manager One",
      cycleIndex: 2,
      cycleLabel: "17/02 - 02/03",
      entryDateKey: "2026-02-28",
      counsellingCount: 2,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }),
  );

  await assertFails(
    setDoc(doc(authedDb("employee1"), "bda_counselling_entries", "entry-employee"), {
      id: "entry-employee",
      bdaUid: "employee1",
      bdaName: "Employee One",
      managerUid: "manager1",
      managerName: "Manager One",
      cycleIndex: 2,
      cycleLabel: "17/02 - 02/03",
      entryDateKey: "2026-02-28",
      counsellingCount: 1,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }),
  );
});

test("allows manager and HR counselling review in scope and denies out-of-scope manager", async () => {
  await assertSucceeds(
    updateDoc(doc(authedDb("manager1"), "bda_counselling_entries", "entry-1"), {
      status: "approved",
      reviewNote: "Validated with call log",
      reviewedAt: now,
      updatedAt: now,
    }),
  );

  await assertSucceeds(
    updateDoc(doc(authedDb("hr1"), "bda_counselling_entries", "entry-1"), {
      status: "rejected",
      reviewNote: "Missing notes",
      reviewedAt: now,
      updatedAt: now,
    }),
  );

  await assertFails(
    updateDoc(doc(authedDb("manager2"), "bda_counselling_entries", "entry-1"), {
      status: "approved",
      updatedAt: now,
    }),
  );

  await assertFails(getDoc(doc(authedDb("employee2"), "bda_counselling_entries", "entry-1")));
});

test("allows scoped PIP writes for manager+ while keeping BDA read-only", async () => {
  await assertSucceeds(getDoc(doc(authedDb("bda1"), "bda_pip_cases", "pip_bda1_1")));
  await assertFails(getDoc(doc(authedDb("employee2"), "bda_pip_cases", "pip_bda1_1")));

  await assertFails(
    updateDoc(doc(authedDb("bda1"), "bda_pip_cases", "pip_bda1_1"), {
      status: "passed",
      updatedAt: now,
    }),
  );

  await assertSucceeds(
    updateDoc(doc(authedDb("manager1"), "bda_pip_cases", "pip_bda1_1"), {
      pipAchievedSales: 1,
      updatedAt: now,
    }),
  );

  await assertFails(
    updateDoc(doc(authedDb("manager2"), "bda_pip_cases", "pip_bda1_1"), {
      pipAchievedSales: 2,
      updatedAt: now,
    }),
  );

  await assertSucceeds(
    setDoc(doc(authedDb("manager1"), "bda_pip_cases", "pip_bda1_2"), {
      id: "pip_bda1_2",
      bdaUid: "bda1",
      bdaName: "BDA One",
      managerUid: "manager1",
      managerName: "Manager One",
      triggerStatus: "missed",
      triggerCycleIndex: 2,
      triggerCycleLabel: "17/02 - 02/03",
      pipCycleIndex: 3,
      pipCycleLabel: "03/03 - 16/03",
      pipTargetSales: 2,
      pipAchievedSales: 0,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
  );
});

test("allows any authenticated user to read finance external accounts but restricts writes", async () => {
  await assertSucceeds(getDoc(doc(authedDb("employee1"), "finance_external_accounts", "account-1")));
  await assertSucceeds(
    setDoc(doc(authedDb("financer1"), "finance_external_accounts", "account-2"), {
      accountHolderName: "Vendor Two",
      createdAt: now,
    }),
  );
  await assertFails(
    setDoc(doc(authedDb("employee1"), "finance_external_accounts", "account-3"), {
      accountHolderName: "Vendor Three",
      createdAt: now,
    }),
  );
});

test("limits finance approval artifacts to finance roles", async () => {
  await assertSucceeds(
    getDoc(doc(authedDb("financer1"), "finance_approval_requests", "request-1")),
  );
  await assertSucceeds(
    getDoc(doc(authedDb("financer1"), "finance_audit_events", "event-1")),
  );
  await assertFails(
    getDoc(doc(authedDb("employee1"), "finance_approval_requests", "request-1")),
  );
  await assertFails(
    getDoc(doc(authedDb("employee1"), "finance_audit_events", "event-1")),
  );
});

test("allows payroll reads for financer and the subject user only", async () => {
  await assertSucceeds(getDoc(doc(authedDb("financer1"), "payroll", "payroll-1")));
  await assertSucceeds(getDoc(doc(authedDb("employee1"), "payroll", "payroll-1")));
  await assertFails(getDoc(doc(authedDb("employee2"), "payroll", "payroll-1")));
});

test("allows presence reads for authenticated users but limits writes to the owner", async () => {
  await assertSucceeds(getDoc(doc(authedDb("employee2"), "presence", "employee1")));
  await assertSucceeds(
    setDoc(
      doc(authedDb("employee1"), "presence", "employee1"),
      {
        uid: "employee1",
        status: "checked_out",
        checkedOutAt: now,
      },
      { merge: true },
    ),
  );
  await assertFails(
    setDoc(
      doc(authedDb("employee2"), "presence", "employee1"),
      {
        uid: "employee1",
        status: "checked_out",
        checkedOutAt: now,
      },
      { merge: true },
    ),
  );
});
