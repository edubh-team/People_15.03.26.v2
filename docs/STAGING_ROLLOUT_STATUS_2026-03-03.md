# Staging Rollout Status - March 3, 2026

Project: `hr-crm-edubh`  
Prefix seed used: `staging_q2`

## Completed

- UAT fixture seed applied successfully:
  - `npm run seed:uat -- --apply --prefix=staging_q2`
  - Wrote 31 fixture documents across users/leads/tasks/HR/finance/bulk-action collections.
- UAT readiness verification passed:
  - `npm run verify:uat -- --prefix=staging_q2`
  - All checks passed (role coverage, lead scenarios, HR/payroll, finance approvals, smart views, bulk logs, prefix integrity).
- Firestore rules and indexes deployed successfully to staging:
  - `firebase deploy --only firestore:rules,firestore:indexes --project hr-crm-edubh`
  - Ruleset released: `projects/hr-crm-edubh/rulesets/ac7a0767-e64b-47aa-b95a-ec083f6bf6a5`

## Validation Gates

- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run test:rules` passed.
- Post-deploy `npm run verify:uat -- --prefix=staging_q2` passed.

## Remaining Before Production

- Manual role-wise UI signoff still required in staging:
  - BDA owner
  - Manager owner
  - HR owner
  - Finance owner
  - Leadership owner
  - Engineering owner
- After role signoff, run production rollout checklist from:
  - `docs/UAT_ROLEWISE_CHECKLIST_2026_Q2.md`
  - `docs/DEPLOYMENT_RUNBOOK.md`
