# Role-wise UAT and Rollout Checklist (Mar-May 2026)

Scope: BDA, Manager, HR, Finance, Leadership.

Use this checklist in staging before production rollout.

## Bootstrap Commands (Staging)

Run these before role-wise UAT so baseline test data stays consistent:

```bash
# 1) preview seed plan
npm run seed:uat -- --prefix=staging_q2

# 2) apply seed writes
npm run seed:uat -- --apply --prefix=staging_q2

# 3) verify baseline coverage (pass/fail output)
npm run verify:uat -- --prefix=staging_q2

# 4) run 2 bi-weekly dry-run simulation
npm run simulate:biweekly -- --cycles=2 --prefix=staging_q2

# 5) execute full staged rollout gate (typecheck + rules + build + verify + simulation)
npm run rollout:staging -- --prefix=staging_q2
```

If `verify:uat` reports missing project id, export one of:

- `NEXT_PUBLIC_FIREBASE_PROJECT_ID=<your-staging-project-id>`
- `FIREBASE_SERVICE_ACCOUNT_KEY=<json-service-account>`

Optional UID mapping for real staging accounts (set in shell before seed apply):

- `UAT_MANAGER_UID`, `UAT_BDA1_UID`, `UAT_BDA2_UID`
- `UAT_SENIOR_MANAGER_UID`, `UAT_HR_UID`, `UAT_FINANCE_UID`, `UAT_SUPER_ADMIN_UID`

## Test Data Baseline

- [ ] At least 2 BDAs, 1 Manager, 1 Senior Manager, 1 HR, 1 Finance, 1 Super Admin.
- [ ] Leads seeded for: new, follow-up due today, overdue, stale, payment follow-up, closed.
- [ ] At least 1 leave request (pending), 1 attendance correction case, 1 payroll-ready employee.
- [ ] At least 1 finance approval request (pending), 1 approved, 1 rejected.

## BDA UAT

- [ ] Open `/crm/leads` and confirm drawer opens in simplified execution mode by default.
- [ ] Confirm primary flow is outcome -> next action -> follow-up in minimal clicks.
- [ ] Apply SOP quick outcome and verify stage/reason/remarks/follow-up prefill.
- [ ] Save status and verify timeline + structured activity entry.
- [ ] Use `/` lead search shortcut and confirm results are scoped and fast.
- [ ] Use `Ctrl+K` global search and open a lead + task from results.

Pass criteria:
- [ ] Average post-call logging <= 20 seconds across 10 runs.
- [ ] No BDA access to finance-only actions/screens.

Week 7 dashboard/alerts checks:
- [ ] My Day `Role Dashboard` shows own sales, bi-weekly target, counselling progress, and PIP status.
- [ ] Alerts appear for cycle-close and target miss scenarios with working drilldown links.

## Manager UAT

- [ ] Pullback and reassign from `/crm/leads` in <= 3 clicks.
- [ ] Assignment reason is mandatory and persisted in transfer timeline.
- [ ] Bulk assignment in `/team` supports explicit lead selection and preview.
- [ ] Bulk execution logs show batch state + drilldown (`lead_changes`, `lead_failures`).
- [ ] `Open in CRM` from bulk drilldown opens targeted lead drawer.
- [ ] Overdue leads trigger escalation notifications for the management chain.

Pass criteria:
- [ ] No silent failures in bulk runs (verify failure rows for each failed lead).
- [ ] Transfer timeline query works by state/actor/reason.

Week 7 dashboard/alerts checks:
- [ ] My Day `Team Heatmap` shows per-BDA sales/counselling/overdue/stale.
- [ ] `At-risk list` highlights at-risk and missed BDAs correctly.
- [ ] `Override queue` reflects pending attendance override items for manager scope.
- [ ] Alert cards (cycle close/target miss/PIP trigger/inactivity expiry) render and open correct target pages.

## HR UAT

- [ ] `/hr` summary counts match `/super-admin/operations` for same date.
- [ ] Attendance status updates persist and reflect in HR and super-admin views.
- [ ] Leave approvals/rejections reflect immediately in leave queue and employee records.
- [ ] Temporary reporting and acting-role edits can be saved from personnel workflows.

Pass criteria:
- [ ] HR flows do not alter sales-only UI behavior.
- [ ] Daily attendance/leave counters match across HR and super-admin pages.

Week 7 dashboard/alerts checks:
- [ ] My Day `Role Dashboard` shows attendance override queue and inactive/PIP population.
- [ ] Pending attendance override count matches `/hr/attendance`.
- [ ] Inactive and PIP population cards align with employee lifecycle and PIP datasets.

## Finance UAT

- [ ] Maker-checker enabled path creates approval request before sensitive write.
- [ ] Approve and reject actions create immutable finance audit events.
- [ ] Finance users can view/edit finance queues; BDA cannot access finance actions.
- [ ] Payroll reads honor finance + subject-user scope rules.

Pass criteria:
- [ ] No finance control components visible in BDA screens.
- [ ] Approval/audit entries are complete and queryable.

## Leadership UAT (Senior Manager and Above)

- [ ] Reports page enforces hierarchy scope correctly for each leadership role.
- [ ] KPI drilldown opens scoped lead lists and does not leak out-of-scope leads.
- [ ] Exception alerts (stale/overdue/transfer backlog) reflect scoped lead set.
- [ ] Scheduled report templates can be saved, paused, resumed, deleted.

Pass criteria:
- [ ] Same template opened by different roles returns role-correct scope.
- [ ] Drill-down links from role dashboard and alerts open accurate scoped employee/lead lists.

## Week 8 Simulation Gate

- [ ] Run `npm run simulate:biweekly -- --cycles=2 --prefix=staging_q2`.
- [ ] Capture simulation output for:
  - [ ] current cycle status,
  - [ ] next two-cycle projections,
  - [ ] predicted PIP trigger exposure.
- [ ] For `--apply` runs, verify `uat_biweekly_simulations` documents are created.

## Staging Signoff

- [ ] `npm run build` passes in staging branch.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test:rules` passes.
- [ ] `npm run verify:uat -- --prefix=staging_q2` passes.
- [ ] `npm run simulate:biweekly -- --cycles=2 --prefix=staging_q2` passes.
- [ ] No P0/P1 defects open.
- [ ] All role owners signed off:
  - [ ] BDA owner
  - [ ] Manager owner
  - [ ] HR owner
  - [ ] Finance owner
  - [ ] Leadership owner
  - [ ] Engineering owner

## Production Rollout Checklist

- [ ] Firestore rules and indexes deployed from approved staging commit.
- [ ] Production env vars verified (`CRON_SECRET`, finance flags, app env labels).
- [ ] Rollout window announced.
- [ ] Smoke tests run post-deploy:
  - [ ] CRM lead status update
  - [ ] Manager reassignment
  - [ ] HR attendance update
  - [ ] Finance approval action
  - [ ] Reports scope check
- [ ] Rollback command/document owner assigned.
