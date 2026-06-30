# Checkpoint A Acceptance Checklist

Scope: BDA/Manager low-friction CRM execution with SOP-assisted outcomes and manager quick controls from `/crm/leads`.

Date baseline: March 2, 2026.

## Preconditions

- App builds and runs locally.
- At least:
  - one BDA account,
  - one Manager account,
  - one lead assigned to BDA,
  - one lead assigned to another team member.
- Lead has phone and email for communication actions.

## Automated Gate (must pass first)

1. `npm run typecheck` passes.
2. `npm run build` passes.
3. `npm run test:rules` passes.

## BDA Acceptance

1. Open `/crm/leads` as BDA.
2. Click `Log outcome` on a lead.
3. Expected:
   - Lead drawer opens on `status`.
   - SOP outcome is preloaded (stage, reason, remarks, and follow-up where applicable).
4. In `status`, click another SOP quick outcome chip.
5. Expected:
   - Stage/reason/status update instantly.
   - Assist banner appears: `SOP template applied`.
6. Save update.
7. Expected:
   - Status changes successfully.
   - Timeline and structured activity entry are created.

Pass condition: BDA can log a compliant outcome in minimal clicks without manual long-form typing.

## Manager Acceptance

1. Open `/crm/leads` as Manager.
2. On a lead not owned by manager, click `Pullback`.
3. Expected:
   - Drawer opens on `assignment`.
   - Assignee is prefilled as manager.
   - Transfer reason is prefilled with manager pullback template.
4. Complete transfer.
5. Expected:
   - Lead owner updates to manager.
   - Transfer timeline includes reason, previous owner, current owner, actor, and timestamp.
6. On any lead, click `Reassign`.
7. Expected:
   - Drawer opens on `assignment`.
   - Transfer reason templates are visible.
   - Reason can be applied in one click.
8. Transfer to another assignee.
9. Expected:
   - Ownership changes correctly.
   - Transfer timeline records complete metadata.

Pass condition: Manager can pull back and reassign quickly from primary CRM list with mandatory reason coverage.

## Regression Checks

1. Open lead via:
   - `Next lead`,
   - `Open top lead`,
   - duplicate console `Open survivor` / `Review duplicate`.
2. Expected:
   - Drawer opens normally.
   - No stale prefilled values leak from previous lead actions.
3. Verify existing call/WA/details actions still work from lead cards/table.

Pass condition: Existing lead operations remain intact after Checkpoint A changes.

## Evidence to capture

- Screenshots:
  - SOP quick outcomes in status section.
  - Manager pullback prefill in assignment section.
  - Transfer timeline entry with reason.
- 2 sample lead IDs used for test runs.
- Role used per run (BDA/Manager).

## Status rule

- Do not mark Checkpoint A complete until all sections above pass.
- If any section fails, record:
  - failing step,
  - observed behavior,
  - expected behavior,
  - lead ID and role.
