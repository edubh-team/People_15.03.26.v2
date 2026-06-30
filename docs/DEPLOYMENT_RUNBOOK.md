# Deployment Runbook

## Environment split

Use separate Firebase projects and `.env.local` files for each deployment target.

- Development
  - `APP_ENV=development`
  - `NEXT_PUBLIC_APP_ENV=development`
  - Use a non-production Firebase project.
- Staging
  - `APP_ENV=staging`
  - `NEXT_PUBLIC_APP_ENV=staging`
  - Use a staging Firebase project that mirrors production shape.
- Production
  - `APP_ENV=production`
  - `NEXT_PUBLIC_APP_ENV=production`
  - Use production Firebase credentials only on the deployed host.

## Required server environment

The deployed server must provide:

- Public Firebase web config
- Firebase Admin credentials
- `SETUP_SECRET`
- `CRON_SECRET` if cron access should be restricted
- Finance approval flags if maker-checker should be active

## UAT Gate

- Use [Role-wise UAT checklist](./UAT_ROLEWISE_CHECKLIST_2026_Q2.md) in staging before production rollout.
- Seed and verify staging baseline before role runs:

```bash
npm run seed:uat -- --apply --prefix=staging_q2
npm run verify:uat -- --prefix=staging_q2
```

- If you need to bind fixtures to real staging users, set UID overrides first:
  - `UAT_MANAGER_UID`, `UAT_BDA1_UID`, `UAT_BDA2_UID`
  - `UAT_SENIOR_MANAGER_UID`, `UAT_HR_UID`, `UAT_FINANCE_UID`, `UAT_SUPER_ADMIN_UID`

## Pre-deploy checks

Run these before merging or pushing to `main`:

```bash
npm ci
npm run typecheck
npm run test:rules
npm run build
```

The GitHub Actions deploy workflow now enforces the same checks before SSH deployment starts.

## Deployment flow

1. Push to `main` or trigger the workflow manually.
2. GitHub Actions runs validation on Node 22.
3. SSH deployment runs `deploy.sh` on the target host.
4. `deploy.sh`:
   - syncs latest code
   - tags the current Docker image as `people-hrms:previous`
   - builds the new image with build-time public env vars
   - restarts the container with runtime env vars from `.env.local`

## Controlled rollout sequence (Week 8)

Run from staging-approved commit only. Keep rollback checkpoint after each stage.

1. Rules + indexes (checkpoint `R1`)
   - `firebase deploy --only firestore:rules`
   - `firebase deploy --only firestore:indexes`
   - Validate:
     - manager assignment still works,
     - BDA assignment remains blocked,
     - attendance override audit remains immutable.
2. Functions/API (checkpoint `R2`)
   - `npm --prefix functions run build`
   - `firebase deploy --only functions`
   - Validate:
     - lifecycle actions work,
     - counselling review actions work,
     - finance approval endpoints unaffected.
3. UI deployment (checkpoint `R3`)
   - `npm run build`
   - deploy app container/workload (`deploy.sh` or CI release pipeline).
   - Validate:
     - My Day role dashboards render by role,
     - role alerts link to correct pages,
     - reports drilldown remains scoped.
4. Post-deploy UAT smoke (checkpoint `R4`)
   - `npm run verify:uat -- --prefix=staging_q2`
   - `npm run simulate:biweekly -- --cycles=2 --prefix=staging_q2`
   - optional full gate: `npm run rollout:staging -- --prefix=staging_q2`

If any checkpoint fails, rollback immediately to previous stable artifact before continuing.

## Rollback

If the latest deployment is unhealthy on the server:

```bash
docker stop people-hrms || true
docker rm people-hrms || true
docker run -d \
  --name people-hrms \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  --env-file .env.local \
  people-hrms:previous
```

After rollback, inspect the failed image and deployment logs before retrying.

### Rollback checkpoints

- `R1` rollback:
  - `firebase deploy --only firestore:rules --project <stable-project> --force` from last stable commit.
  - `firebase deploy --only firestore:indexes --project <stable-project> --force` from last stable commit.
- `R2` rollback:
  - `firebase deploy --only functions --project <stable-project>` from last stable functions tag.
- `R3` rollback:
  - restore container image `people-hrms:previous` (commands above).
- `R4` rollback:
  - keep production on `R3` if smoke checks fail, then re-run UAT on staging before retry.

## Notes

- Local changes do not affect production until they are deployed.
- Local development can still affect live Firebase data if production credentials are used in `.env.local`.
- Finance maker-checker stays disabled until `FINANCE_MAKER_CHECKER_ENABLED` is set.
