# Deploy Status

_Last updated: 2026-06-21_

## Current deployed versions

| Tier | Tag / commit         | State                                  |
| ---- | -------------------- | -------------------------------------- |
| Dev  | `v1.1.0-rc.6` (`6f8dada`) | Deployed, healthy. e2e green (20/20, 1 skipped). |
| Prod | `v1.0.0`             | Last stable. **Not yet promoted to v1.1.0.** |

## v1.1.0 highlights (vs v1.0.0)

- Board/admin redesign, mobile nav + responsive sheets + dark mode.
- Notification preferences, email invites, optimistic create + a11y.
- Live-domain e2e suite (auth) + `is_test` rate-limit exemption.

## E2E (live-domain model)

- Runs against the live site (`E2E_BASE_URL`) as pre-seeded test users via
  `packages/infra/deploy-scripts/run-e2e.sh` (own compose project, runner
  removed after). No test DB/MinIO. OTP read from the Mailtrap sandbox.
- Test-user emails: `packages/shared/test-user.ts` (`TEST_USERS`). Provision with
  `seedTestUsers` (sets `is_test=true`, verified). Admin = the super admin.
- Per tier in `packages/infra/.env`: `E2E_PASSWORD`, `E2E_ADMIN_EMAIL`,
  `E2E_ADMIN_PASSWORD`, `MAILTRAP_API_TOKEN`. `run-e2e.sh` sets `E2E_BASE_URL` +
  `E2E_ALLOW_DESTRUCTIVE` (dev=true, prod=false).
- Destructive specs (sign-up/verify/forgot) run on **dev only**; prod runs the
  non-destructive subset.

### Dev e2e result (rc.6)

- 20 passed, 1 skipped (backup placeholder), 0 failed. Deterministic — test
  users bypass the per-IP login rate limiter via `users.is_test`.

## Dev environment notes

- Mailtrap creds added to `backend/.env.prod` so the live backend sends OTP to
  the sandbox.
- Test accounts seeded with `is_test=true`: `e2e@thatnails.com`,
  `e2eresetemail@thatnails.com`.

## Pending

- [ ] Present the Phase-3 checklist and get approval to tag `v1.1.0` (prod).
- [ ] Prod: provision test accounts (`seedTestUsers`) + `E2E_*` env, set
      `MAIL_USER/PASS` in `backend/.env.prod`, then `run-e2e.sh` (non-destructive).
- [ ] Convert the skipped admin-backup e2e to the live-user model.
