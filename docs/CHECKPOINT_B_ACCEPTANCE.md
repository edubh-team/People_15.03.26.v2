# Checkpoint B Acceptance Checklist

Scope: SLA urgency visibility in `/crm/leads` + safer bulk preview clarity in `/team`.

Date baseline: March 2, 2026.

## Automated Gate

1. `npm run typecheck` passes.
2. `npm run build` passes.
3. `npm run test:rules` passes.

## CRM SLA Visibility

1. Open `/crm/leads` with leads that include:
   - at least one overdue follow-up (`nextFollowUpDateKey < today`),
   - at least one due-today follow-up (`nextFollowUpDateKey === today`).
2. Expected in queue header:
   - overdue counter chip appears when overdue leads exist,
   - due-today counter chip appears when due-today leads exist.
3. Expected in lead rows/cards:
   - each due/overdue lead shows an SLA badge (`SLA due today` or `SLA overdue by N day(s)`).
4. Open a due/overdue lead drawer.
5. Expected in drawer:
   - SLA badge appears near top lead status chips,
   - Next Follow Up card shows the same SLA badge,
   - Next Best Actions includes SLA action prompt to jump to status update.

Pass condition: SLA urgency is visible without opening multiple screens.

## Team Bulk Preview Clarity

1. Open `/team` and go to Assignment Console v2.
2. In preview box, confirm counters show:
   - `matched`,
   - `locked skipped`,
   - `merged skipped`.
3. Build a run where selected leads produce zero field-level diffs.
4. Expected:
   - preview warns that apply will still write timeline/audit records.

Pass condition: manager can see skipped merged records and no-op bulk behavior before apply.

## Status Rule

- Do not mark Checkpoint B complete until every section above passes.
- If any step fails, capture:
  - failing step,
  - observed behavior,
  - expected behavior,
  - lead IDs and role used.
