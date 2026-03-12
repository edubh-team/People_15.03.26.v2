# Consolidation Execution Plan

## Non-Negotiable Rules

1. Merge by business domain, not by route name.
2. Preserve role-specific behavior inside a single hierarchy-aware module.
3. Do not delete any useful legacy flow until the upgraded replacement has functional parity.
4. Redirect old routes before deleting them.
5. Keep the hierarchy model as the control plane for access, scope, assignment, pullback, and reporting.

## Current Hierarchy Model To Preserve

- `BDA`
- `Manager`
- `Senior Manager`
- `GM`
- `AVP`
- `VP`
- `Sales Head`
- `CBO`
- `CEO`

Hierarchy implications:

- `BDA`: personal execution only
- `Manager and above`: can read downline, assign in subtree, pull leads back to self, and report on subtree
- `Super Admin / Admin / HR / Finance`: keep domain-specific controls outside the sales tree where required

## Audit Summary

The project does have overlapping routes, but not all overlap is duplication. There are three categories:

1. True duplicates
   Same business flow implemented twice with different UI generations.
2. Role variants
   Same domain, different responsibilities by hierarchy or department.
3. Shared workflow split across multiple pages
   One side is self-service, another side is oversight or admin.

The consolidation plan must only merge category 1 directly. Categories 2 and 3 should share data/services/components while preserving separate role modes where needed.

## Validated Route Decisions

### 1. CRM / Leads

Current routes:

- `src/app/(protected)/crm/leads/page.tsx`
- `src/app/(protected)/leads/new/page.tsx`
- `src/app/(protected)/leads/previous/page.tsx`
- `src/app/(protected)/super-admin/leads/page.tsx`

Current unique behavior:

- `/crm/leads`
  - current CRM workbench
  - role-aware BDA vs leadership behavior
  - inspector-enabled admin flow
- `/leads/new`
  - lightweight "my new leads" execution queue
- `/leads/previous`
  - lightweight worked-leads/history queue
  - still uses legacy `LeadDetailModal` and `StatusUpdateModal`
- `/super-admin/leads`
  - recent org-wide split of new vs worked leads in tabular form

Decision:

- Keep one CRM route: `/crm/leads`
- Fold legacy behavior into `/crm/leads` as:
  - `New Leads` saved/system view
  - `Worked Leads` saved/system view
  - `Global Inspector` admin tab/panel

Delete gate:

- Do not retire `/leads/new`, `/leads/previous`, or `/super-admin/leads` until `/crm/leads` covers:
  - fast BDA queue handling
  - worked-lead history
  - admin global view
  - import entry points
  - all lead actions now exposed by old modals

### 2. Team / Leadership

Current routes:

- `src/app/(protected)/team/page.tsx`
- `src/app/(protected)/team-lead/page.tsx`
- `src/app/(protected)/team/admin/page.tsx`
- `src/app/(protected)/super-admin/operations/page.tsx`

Current unique behavior:

- `/team`
  - manager cockpit
  - stale/follow-up/closure queues
  - assignment console
  - import access
- `/team-lead`
  - smaller operational dashboard
  - subordinate presence and tasks
  - approval and unassigned lead handling
- `/team/admin`
  - admin control tower
  - quick task broadcast
  - employee recognition and monthly target controls
- `/super-admin/operations`
  - older global operations tools
  - includes leave authority and global calendar style utilities

Decision:

- Keep one leadership module entry: `/team`
- Preserve role-specific modes:
  - `Team Lead`: lightweight queue and rep monitoring
  - `Manager`: cockpit, routing, rescue, assignment
  - `Senior Manager+`: wider subtree operations
  - `Super Admin`: global ops tab

Delete gate:

- Do not retire `/team-lead`, `/team/admin`, or `/super-admin/operations` until `/team` includes:
  - team-lead quick monitoring workflows
  - admin quick-task and recognition workflows if still used
  - operations-only global tools that are still relevant

### 3. Attendance

Current routes:

- `src/app/(protected)/attendance/page.tsx`
- `src/app/(protected)/hr/attendance/page.tsx`

Current unique behavior:

- `/attendance`
  - self-service check-in/out
  - leave application
  - personal history
  - attendance calendar
- `/hr/attendance`
  - oversight by date
  - manual correction/edit
  - org-wide attendance review

Decision:

- Keep both route intents
- Merge internals into one attendance domain:
  - shared queries
  - shared date/status helpers
  - shared correction models

Delete gate:

- None at route level right now
- This is a role split, not a route duplication problem

### 4. People / Personnel

Current routes:

- `src/app/(protected)/hr/employees/page.tsx`
- `src/app/(protected)/super-admin/personnel/page.tsx`
- `src/app/(protected)/admin/employees/page.tsx`

Current unique behavior:

- `/hr/employees`
  - HR directory
  - onboarding
  - termination
  - filters/search
- `/super-admin/personnel`
  - hierarchy control
  - acting role
  - temporary reporting
  - HR assignment
  - hiring and deeper personnel administration
- `/admin/employees`
  - needs to be reviewed during implementation and mapped into the same people module

Decision:

- Keep one people module
- Preserve role-based tabs:
  - `Directory`
  - `Onboarding`
  - `Employment Actions`
  - `Hierarchy`
  - `Temporary Reporting`
  - `HR Assignment`

Delete gate:

- Do not retire old people routes until the unified people module supports:
  - HR daily operations
  - super-admin hierarchy editing
  - onboarding and termination

### 5. Leaves

Current routes:

- self-service leave inside `src/app/(protected)/attendance/page.tsx`
- HR leave queue in `src/app/(protected)/hr/leaves/page.tsx`

Current issue:

- inconsistent collection names:
  - `leaveRequests`
  - `leave_requests`

Decision:

- Keep employee leave application and HR approval as two views of one workflow
- Standardize on one leave data model before any UI merge

Delete gate:

- None until the data model is normalized

### 6. Payroll

Current routes:

- `src/app/(protected)/hr/payroll/page.tsx`
- `src/app/(protected)/super-admin/payroll/page.tsx`
- `src/app/(protected)/admin/payroll/vault/page.tsx`

Current unique behavior:

- `/hr/payroll`
  - run payroll
  - edit payroll entries
  - download payslips
- `/super-admin/payroll`
  - compensation structure editing
  - bonus dispatch
  - hike workflow style controls
  - vault-style security gate
- `/admin/payroll/vault`
  - read-heavy secure compensation and bank detail access

Decision:

- Keep one payroll module
- Preserve role-based tabs:
  - `Run Payroll`
  - `Compensation`
  - `Vault`
  - `Hikes / Adjustments`

Delete gate:

- Do not retire any payroll route until the unified payroll module supports:
  - HR payroll processing
  - secure salary/bank access
  - compensation editing
  - bonus/hike workflows

### 7. Personal Home / Employee Legacy

Current routes:

- `src/app/(protected)/dashboard/page.tsx`
- `src/app/(protected)/employee/page.tsx`

Current unique behavior:

- `/dashboard`
  - current personal home
  - attendance widgets
  - BDA KPI and lead/task quick access
- `/employee`
  - older personal dashboard
  - mostly legacy attendance/personal status surface

Decision:

- Keep `/dashboard` as personal home
- Keep `/attendance` as the deep attendance page
- Retire `/employee` after migrating any remaining useful personal actions

Delete gate:

- Confirm no personal-only control still exists only in `/employee`

### 8. Reports

Current routes:

- `src/app/(protected)/reports/page.tsx`
- `src/app/(protected)/reports/[employeeId]/page.tsx`
- `src/app/(protected)/manager/dashboard/page.tsx`
- `src/app/(protected)/hr/dashboard/page.tsx`

Decision:

- Keep reports as a separate reporting module
- Keep role-specific dashboards for home/landing use
- Unify report metric sources under shared reporting logic
- Keep employee drilldown as report drilldown, not a parallel reporting system

## Module Keep / Redirect Matrix

### Keep As Primary Module Entrypoints

- `/crm/leads`
- `/team`
- `/attendance`
- `/hr`
  - internally unified as people operations
- `/reports`
- `/dashboard`

### Convert To Redirect Candidates After Parity

- `/leads/new`
- `/leads/previous`
- `/super-admin/leads`
- `/team-lead`
- `/team/admin`
- `/super-admin/operations`
- `/employee`
- old payroll sub-surfaces after payroll module parity

### Keep As Secondary Role Entrypoints For Now

- `/hr/attendance`
- `/hr/leaves`
- `/reports/[employeeId]`

These may remain as deep links even after internals are unified.

## Critical Existing Issues To Fix During Consolidation

1. Leave data inconsistency
   - `leaveRequests` vs `leave_requests`

2. CRM legacy modal duplication
   - `LeadDetailModal`
   - `StatusUpdateModal`
   - `ImportLeadsModal`
   - newer replacements already exist and should become the only maintained path after parity

3. Team assignment flow
   - count/bucket must only find candidates
   - manager must manually confirm exact selected leads before apply

4. Lead list scale
   - current lead card density is too low for 1,000+ leads
   - CRM default needs compact row/table mode, sticky controls, pagination/cursor loading, bulk tray, and right-side drawer

5. Old direct reassignment paths
   - any remaining old direct owner writes must be normalized onto the custody helper before old pages are retired

## Hierarchy Behavior Matrix

### CRM

- `BDA`
  - own queue only
  - update status
  - log activities
  - create next tasks
- `Manager`
  - subtree queue
  - pullback to self
  - reassign in subtree
  - bulk actions
  - rescue and stale-lead control
- `Senior Manager+`
  - same controls across larger subtree
- `Super Admin`
  - global inspector and audit-oriented controls

### Team Module

- `Team Lead`
  - monitor team execution
  - assign within controlled subset if allowed
  - manage quick operational actions
- `Manager`
  - full assignment console
  - pullback and redistribution
  - workload balancing
- `Senior Manager+`
  - subtree management over managers and teams
- `Super Admin`
  - global operations mode

### People Module

- `HR`
  - directory
  - onboarding
  - leave/attendance oversight
- `Super Admin`
  - all HR capabilities plus hierarchy and temporary reporting controls

### Payroll Module

- `HR`
  - payroll run and payroll edits
- `Admin / Super Admin`
  - compensation and secure vault
- `Finance`
  - read/write only where current finance controls allow

## Migration Safety Rule

Every consolidation step follows the same gate:

1. inventory old behavior
2. build upgraded replacement in target module
3. validate role-by-role parity
4. redirect old route
5. remove old implementation only after stable usage

No useful old functionality should be deleted before step 3 is complete.

## Execution Order

### Phase 1: CRM Consolidation

- absorb `/leads/new` into `/crm/leads`
- absorb `/leads/previous` into `/crm/leads`
- absorb `/super-admin/leads` into `/crm/leads`
- replace high-space lead list with compact scalable list
- keep lead drawer as the only detail/edit surface

### Phase 2: Team Consolidation

- merge `/team-lead`, `/team/admin`, and relevant `/super-admin/operations` workflows into `/team`
- preserve role-specific tabs by hierarchy
- convert count-based assignment into candidate preview plus explicit selection

### Phase 3: People And Leave Consolidation

- normalize leave collection/model first
- merge HR employee management and personnel administration into one people module
- preserve super-admin-only hierarchy controls

### Phase 4: Payroll Consolidation

- unify payroll processing, compensation, vault, and hike/adjustment flows
- preserve security boundaries and role-specific access

### Phase 5: Report And Dashboard Cleanup

- retire `/employee`
- keep `/dashboard` as personal home
- unify reporting sources and drilldowns

## Acceptance Criteria

The consolidation is successful only when:

1. no business flow exists in two places without a clear reason
2. role-specific behavior is preserved through hierarchy-aware modules
3. no useful old feature is removed before replacement parity
4. lead assignment and transfer remain auditable
5. CRM remains operable at 10,000+ lead scale
6. navigation becomes simpler, not flatter and more confusing

## First Implementation Tranche

Start here:

1. CRM consolidation and lead list scale fixes
2. team consolidation and explicit candidate-based assignment
3. leave model normalization

Reason:

- these are the highest-volume surfaces
- these currently carry the most duplication risk
- they affect BDAs, managers, and leadership daily
