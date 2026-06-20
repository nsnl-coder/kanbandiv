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

.env for client and server:

- env.local: for local development
- env.prod: for both dev vps and prod vps
- env.dev: overwrite some of env.prod for dev vps

## Always-on conventions

Always follow token discipline (short replies, scoped file reads, no rambling). The full ruleset is imported below and applies to every session:
@.claude/skills/token/SKILL.md
