# Checkpoint C Acceptance Checklist

Scope: manager-side bulk execution traceability in `/team` via live `crm_bulk_actions` visibility.

Date baseline: March 2, 2026.

## Automated Gate

1. `npm run typecheck` passes.
2. `npm run build` passes.
3. `npm run test:rules` passes.

## Team Assignment Console Execution Logs

1. Open `/team` with a manager/super-admin account.
2. Run one bulk action from Assignment Console v2.
3. Expected:
   - `Recent execution logs` panel shows a new batch entry.
   - Entry includes state badge, batch ID, summary, updated/requested counts, and failure counters.
4. Click `Copy batch ID`.
5. Expected:
   - batch ID is copied and can be used for log lookup.
6. For any run with issues (if present), expected:
   - `completed_with_issues` or `failed` state is visible,
   - failure message and counters are displayed.

Pass condition: manager can validate bulk run outcomes and failure footprint from one screen without querying Firestore manually.

## Status Rule

- Do not mark Checkpoint C complete until all sections above pass.
- If any section fails, record:
  - failing step,
  - observed behavior,
  - expected behavior,
  - account role and batch ID used.
