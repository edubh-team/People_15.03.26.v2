# Weekly Implementation Plan

This rollout is additive-first. Existing behavior stays intact unless a change is explicitly gated by a new environment variable or a newly introduced collection/path.

## Rule Policy

- Existing Firestore and Storage rule behavior should not be removed during the rollout.
- New rules can be added for new collections or future hardened flows.
- Tightening an existing live path should only happen after the replacement path is shipped and verified.

## Week 1: Non-Breaking Hardening

- Centralize server request guards for finance, leadership, and user-creation APIs.
- Add optional `CRON_SECRET` enforcement to `/api/cron/auto-checkout`.
- Add server-only `SETUP_SECRET` support to `/api/setup/promote` while keeping `NEXT_PUBLIC_SETUP_KEY` fallback.
- Keep all current UI flows working without requiring immediate env changes.

Status: Implemented

## Week 2: Rules Safety Net

- Add emulator-backed regression coverage for current Firestore rule behavior.
- Freeze today’s allow/deny matrix before changing any live rule semantics.
- Add explicit tests around finance collections, tasks, notifications, and leadership access paths.

Status: Implemented

## Week 3: Identity and Session Hardening

- Replace raw ID-token cookie session flow with Admin session cookies.
- Standardize request-user resolution for all protected API routes.
- Add structured audit logging for privilege escalation and administrative actions.

Status: Implemented

## Week 4: Data Model Stabilization

- Normalize task assignee fields across reads and writes.
- Canonicalize lead statuses and add migration-safe compatibility helpers.
- Introduce write-safe adapters where legacy and canonical fields coexist.

Status: Implemented

## Week 5: Finance Controls

- Introduce maker-checker support for sensitive finance actions.
- Add approval metadata, reason capture, and immutable audit events.
- Prepare additive rule paths for more private finance artifacts without breaking current pages.

Status: Implemented

## Week 6: Environment and Release Discipline

- Separate development, staging, and production configuration.
- Align Node/runtime versions across local, Docker, and deployment workflows.
- Document deployment prerequisites and rollback steps.

Status: Implemented

## Week 7: Server Audit Coverage

- Add server-side audit entries for privileged setup, finance, user-creation, and scheduled system actions.
- Keep audit writes additive so existing collections and views continue to work.
- Extend finance with immutable event records for approval requests and decisions.

Status: Implemented

## Week 8: CRM Smart Views

- Build a BDA-first CRM workbench with saved tabs for new leads, due-today follow-ups, stale leads, payment-stage leads, callbacks, and closures.
- Show live counts, role-aware defaults, and quick actions from one queue surface.
- Keep manager and admin visibility on the same workbench model with scoped data.

Status: Implemented

## Week 9: Lead Command Center

- Turn lead details into a single command surface for assignment, status, notes, documents, and linked tasks.
- Keep all lead context in one drawer instead of spreading action across modals.
- Make timeline and audit history available from the same CRM surface.

Status: Implemented

## Week 10: Tasks Execution Desk

- Rebuild tasks as a daily execution desk with list and calendar views.
- Add quick filters, bulk reschedule, bulk complete, and live scoped counts.
- Keep team and admin scopes on the same task model without breaking existing task documents.

Status: Implemented

## Week 11: Structured CRM Activities

- Split CRM activities from tasks so completed interactions and next actions are modeled separately.
- Add immutable structured activity records for calls, demos, documents, payment reminders, and parent interactions.
- Use the activity stream for stale-lead detection and manager visibility.

Status: Implemented

## Week 12: Automation and Routing v1

- Auto-route new imported and manager-created leads using presence, quota, and open-load balancing.
- Auto-create or resolve system-generated follow-up tasks when lead status changes require next action.
- Add a CRM automation cron that reminds owners and supervisors about due and overdue follow-up SLAs.

Status: Implemented

## Week 13: Lead-Task Referential Integrity

- Sync canonical lead references into every linked task write path so `leadId`, `leadName`, `leadStatus`, and `leadOwnerUid` stay aligned.
- Detect orphaned linked tasks and owner drift inside `/tasks` and manager-facing reporting.
- Add reassignment guardrails so lead ownership changes can move open linked tasks with the lead or explicitly leave them as drifted exceptions.
- Extend the task migration dry-run to report broken lead links before apply mode.

Status: Implemented

## Week 14: Role-Based Layouts and Permissions Simplification

- Centralize role layout decisions so home routing, shell navigation, CRM drawer sections, and setup visibility read from one profile source.
- Remove irrelevant shell controls for non-admin users, including hiding `System Setup` outside admin/super-admin paths.
- Simplify CRM for BDAs by hiding leadership-only sections like reassignment and audit, while keeping manager/admin controls intact.
- Restrict the legacy `Lead Inspector` surface to admin-level CRM layouts and keep managers on the action-first workbench.

Status: Implemented

## Week 15: Speed, Mobile, and Adoption Polish

- Make the CRM workbench faster on mobile with horizontally scrollable smart-view tabs, larger touch targets, and quick-open access to the top lead in queue.
- Add sticky command-center actions and keyboard shortcuts so BDAs can save the current section without scrolling back through the drawer.
- Improve lead import review with import/skip counts, clean-vs-flagged filters, and clearer duplicate-match visibility before bulk upload.
- Add a manager-facing daily summary strip on reports so coverage and follow-up hotspots are visible before drilling into the hierarchy.

Status: Implemented

## Week 16: Query, Index, and Pagination Hardening

- Replace broad user/report subscriptions with scoped hierarchy listeners so CRM, reports, and directory pages only watch the reporting tree in scope.
- Cap CRM lead read windows per owner stream and add the supporting composite indexes for `assignedTo`, `ownerUid`, and `closedBy.uid` queue reads.
- Keep admin search available while constraining revenue and inspector views to recent windows instead of unbounded collection scans.
- Narrow directory presence/task listeners to visible users only so manager and HR views scale with team size instead of org size.

Status: Implemented

## Week 17: Manager Cockpit v2

- Extend `/team` into a manager intervention cockpit with live cards for stale leads, overdue follow-ups, open tasks, overloaded reps, and closures today.
- Add a rep workload heatmap that surfaces capacity pressure, stale lead burden, overdue follow-ups, and same-day wins per rep.
- Add one-click reassignment from the stale and overdue queues, and keep linked tasks aligned with the lead owner during those manager interventions.
- Preserve the existing assignment, approval, import, presence, and task-allotment flows underneath the new cockpit so managers still have one operational screen.

Status: Implemented

## Week 18: Workflow Automation v2

- Expand CRM automation beyond a single follow-up task so status changes, payment-stage leads, inactivity, missed follow-ups, and supervisor escalations all use one workflow engine.
- Keep status and activity updates responsible for real-time follow-up and payment-review task sync, while the cron route owns stale-lead recovery and overdue escalation upkeep.
- Use deterministic system-task IDs so repeated cron runs update the same workflow tasks instead of spraying duplicates across `/tasks`.
- Keep closure automation non-breaking by auto-resolving obsolete workflow tasks when a lead exits the active funnel.

Status: Implemented

## Week 19: Smart Views Personalization

- Add saved Smart Views on top of the Week 8 CRM workbench so users can preserve tab, search, and filter state instead of relying only on local tab memory.
- Support pinned personal views, owner/status filters, and personal default views so BDAs and managers land directly in their preferred queue.
- Add manager-pushed team views by storing shared Smart View docs for the current CRM scope, keeping distribution additive and non-breaking.
- Protect the new `crm_smart_views` collection with additive read/write rules and regression coverage.

Status: Implemented

## Week 20: Duplicate Queue and Merge Console

- Add a live duplicate review queue to the CRM workbench so managers can review likely duplicate lead groups without leaving the Smart View surface.
- Support a merge console with survivor selection, non-destructive survivor rules, conflict preview, and safe task relinking instead of hard deletes.
- Keep duplicate cleanup additive by marking merged leads with merge metadata, hiding them from normal queues, and writing merge history to the existing lead audit timeline.

Status: Implemented

## Week 21: Communication Center

- Turn the lead drawer into the primary outreach surface with reusable WhatsApp and email templates, structured call-outcome presets, and next-best-action suggestions.
- Keep communication logging fast by writing template-triggered outreach into the immutable lead activity feed instead of introducing a parallel note process.
- Keep delivery low-risk by using prefilled WhatsApp and mailto flows rather than introducing a new messaging backend.

Status: Implemented

## Week 22: Bulk Queue Actions

- Add manager-side bulk queue actions on `/team` so stale and overdue queues can be reassigned, rescheduled, status-shifted, and retagged in one pass.
- Support additive campaign/source tagging and follow-up pushes while preserving per-lead audit history and timeline entries for every bulk action.
- Keep task and CRM automation behavior aligned by syncing linked tasks and workflow automation after bulk updates.

Status: Implemented

## Week 23: Sales Hierarchy Foundation

- Add canonical sales hierarchy support for `BDA`, `Team Lead`, `Manager`, `Senior Manager`, `GM`, `AVP`, `VP`, `Sales Head`, `CBO`, and `CEO`, while preserving the existing admin, HR, and finance roles.
- Move leadership access from flat manager/team-lead checks to rank plus reporting-tree scope for team pages, reports, CRM assignment, and routing.
- Define hierarchy-driven rights for read scope, assignment scope, pullback scope, and report scope so manager and above flows work consistently across the app.
- Add temporary reporting and acting-role fields to support leave coverage and attrition without rewriting the permanent org tree.

Status: Implemented

## New Environment Variables

- `SETUP_SECRET`
  Server-only secret for `/api/setup/promote`. If unset, the route falls back to `NEXT_PUBLIC_SETUP_KEY`.

- `CRON_SECRET`
  Optional secret for `/api/cron/auto-checkout` and `/api/cron/crm-automation`. If unset, current open behavior remains unchanged.

- `CRM_STALE_LEAD_HOURS`
  Optional inactivity threshold for CRM reactivation automation. Defaults to `24`.

- `CRM_OVERDUE_ESCALATION_DAYS`
  Optional overdue threshold for manager escalation tasks in `/api/cron/crm-automation`. Defaults to `1`.

- `FINANCE_MAKER_CHECKER_ENABLED`
  Enables approval gating for sensitive finance actions.

- `FINANCE_APPROVAL_MIN_AMOUNT`
  Minimum transaction amount that triggers finance approval when maker-checker is enabled. Defaults to `50000`.

- `FINANCE_APPROVAL_CATEGORIES`
  Comma-separated finance categories that always require approval when maker-checker is enabled.

- `FINANCE_APPROVAL_ALL_DEBITS`
  If set, every debit requires approval when maker-checker is enabled.

- `FINANCE_DELETE_REQUIRES_APPROVAL`
  Controls whether ledger deletions go through the approval queue when maker-checker is enabled. Defaults to enabled.

- `APP_ENV`
  Server-side environment label used for deployment discipline and audit tagging. Expected values: `development`, `staging`, `production`.

- `NEXT_PUBLIC_APP_ENV`
  Optional client-visible environment label for build-time separation across deployment targets.
