## project config

This is mono repo, pnpm workspace.

## Folder Structure

packages/frontend: frontend app
packages/backend: backend app
packages/infra: docker, nginx, redis, minio, postgres config, deploy, deploy info
packages/shared: for shared configs, enums, constants, validation schemas, types between frontend and backend
e2e/frontend: store all e2e tests for packages/frontend
e2e/landing: store all e2e tests from packages/landing

## Required Infra

- Nginx: for proxy
- Minio: for files storage
- Postgres: for database -> in docker container
- Required for dev & prod vps but not for local env: docker, redis, loki, vector, grafana, sentry, open telemetery & grafana tempo

# env rules for deploy to vps

## Backend: one thin `.env`

`packages/backend/.env` is the ONLY backend env file (local, dev, and prod).

- Constants identical across tiers live in code (`src/config/env.config.ts`),
  not in `.env`. Anything derivable from `VPS_ENV` is derived in code too.
- `.env` holds only secrets + per-deployment values that cannot be figured in code.
- Tier knob is `VPS_ENV` (local|dev|prod), guarded in `env.config.ts`. Locally it
  comes from `.env`; on the VPS the container env injects it (overrides `.env`).
- A value that differs per tier uses a `_LOCAL` / `_DEV` / `_PROD` suffix.
  `env.config.ts` resolves `KEY_<TIER>` first, then falls back to plain `KEY`
  (the shared value). Keys injected by docker `environment:` (MinIO creds, CORS,
  SSO, REDIS, OTEL) stay plain in `infra/.env` and get no backend suffix.

## Frontend: one `.env`

`packages/frontend/.env` is the ONLY frontend env file (all tiers). Only `VITE_*`
vars; no secrets.

- Tier is derived from the Vite build mode in `src/config/env.config.ts`
  (`--mode local` -> local; `--mode dev` -> dev; `--mode prod` -> prod), not from an env var.
- Constants identical across tiers (Sentry DSN, OTLP path) live in code.
- Only `VITE_API_URL` differs per tier, so the file carries
  `VITE_API_URL_LOCAL` / `_DEV` / `_PROD` (referenced literally so Vite inlines them).

## Always-on conventions

Always follow token discipline (short replies, scoped file reads, no rambling). The full ruleset is imported below and applies to every session:
@.claude/skills/token/SKILL.md

# Testing rules

- e2e tests run against a live deployed site (dev + prod domains) driving a pre-seeded test user via the real UI. No separate test DB/MinIO; OTP flows read codes from the Mailtrap sandbox (used in dev AND prod). Destructive flows use throwaway sign-up emails / a dedicated reset account so they never disturb real users.
- in local environment, only run added test suites, do not run all test suites.
