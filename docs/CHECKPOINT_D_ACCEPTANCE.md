# Checkpoint D Acceptance Checklist

Scope: bulk execution drilldown in `/team` (batch-level + lead-level details).

Date baseline: March 2, 2026.

## Automated Gate

1. `npm run build` passes.
2. `npm run typecheck` passes.
3. `npm run test:rules` passes.

## UI Drilldown Validation

1. Open `/team` as manager or super-admin.
2. Go to Assignment Console v2 and confirm `Recent execution logs` is visible.
3. Click `View details` on any batch entry.
4. Expected:
   - `Lead failures` section loads and lists per-lead failure rows (if any).
   - `Lead changes` section loads and lists per-lead change snapshots.
   - Row details include lead ID and summary/owner-status transitions.
   - `Open in CRM` links route to `/crm/leads` and open the targeted lead drawer.
5. Click `Hide details`.
6. Expected:
   - detail panel collapses cleanly without affecting other batches.

Pass condition: manager can inspect bulk batch outcomes and lead-level exceptions directly in the team console.

## Rules Validation

1. Verify manager/team-lead can read:
   - `/crm_bulk_actions/{batchId}`
   - `/crm_bulk_actions/{batchId}/lead_changes/{changeId}`
   - `/crm_bulk_actions/{batchId}/lead_failures/{failureId}`
2. Verify non-management user cannot read these paths.

Pass condition: detail reads are allowed only for authorized leadership roles.
