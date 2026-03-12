This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Implementation Track

- Weekly rollout plan: [docs/WEEKLY_IMPLEMENTATION_PLAN.md](./docs/WEEKLY_IMPLEMENTATION_PLAN.md)
- Deployment runbook: [docs/DEPLOYMENT_RUNBOOK.md](./docs/DEPLOYMENT_RUNBOOK.md)
- New optional hardening env vars:
  - `SETUP_SECRET`: server-only bootstrap secret for `/api/setup/promote`
  - `CRON_SECRET`: optional secret for `/api/cron/auto-checkout` and `/api/cron/crm-automation`
  - `CRM_STALE_LEAD_HOURS`: inactivity threshold for CRM reactivation automation, defaults to `24`
  - `CRM_OVERDUE_ESCALATION_DAYS`: overdue threshold for manager escalation tasks, defaults to `1`
  - `FINANCE_MAKER_CHECKER_ENABLED`: enables maker-checker approval flow for sensitive finance actions
  - `FINANCE_APPROVAL_MIN_AMOUNT`: finance approval threshold, defaults to `50000`
  - `FINANCE_APPROVAL_CATEGORIES`: comma-separated finance categories that always require approval
  - `FINANCE_APPROVAL_ALL_DEBITS`: routes every debit through finance approval when enabled
  - `FINANCE_DELETE_REQUIRES_APPROVAL`: keeps ledger deletions in the approval queue when enabled
  - `APP_ENV`: server-side environment label used in deploy discipline and audit logs
  - `NEXT_PUBLIC_APP_ENV`: optional build-time environment label for client-visible separation
- Regression and migration commands:
  - `npm run test:rules`: runs Firestore rules regression tests against the local emulator
  - `npm run migrate:tasks -- --apply`: backfills task assignee identity fields and syncs linked lead metadata (`leadName`, `leadStatus`, `leadOwnerUid`)
  - `npm run migrate:leads -- --apply`: normalizes lead statuses and backfills `nextFollowUpDateKey`
  - Omit `--apply` to run either migration in dry-run mode first
- CRM automation surfaces:
  - `/api/cron/crm-automation`: sends due/overdue reminders, raises stale-lead recovery tasks, and escalates long-overdue leads to supervisors
  - manager and team-lead lead imports now auto-route across checked-in team members using quota/load balancing
  - status and activity updates in the CRM drawer now create or resolve system-generated follow-up and payment-review tasks
  - `/tasks` and employee reports now surface orphaned lead links and owner drift
  - `/crm/leads` now supports saved Smart Views with pinned filters, personal defaults, and manager-pushed team views
  - `/crm/leads` now includes a duplicate review queue and merge console that marks merged leads safely instead of deleting them
  - the CRM lead drawer now includes a communication center with reusable WhatsApp/email templates, quick call outcomes, and next-best-action prompts
  - `/team` now supports bulk queue actions for assignment, follow-up rescheduling, status shifts, and campaign/source tagging with audit-safe history

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
