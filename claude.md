## project config

This is mono repo, pnpm workspace.

packages/frontend: frontend app
packages/backend: backend app
packages/infra: config file for docker, nginx, minio
packages/shared: for shared configs, enums, constants, validation schemas, types between frontend and backend

.env for client and server:

- env.local: for local development
- env.prod: for both dev vps and prod vps
- env.dev: overwrite some of env.prod for dev vps

## app users

- admin
- user
-

## Always-on conventions

Always follow token discipline (short replies, scoped file reads, no rambling). The full ruleset is imported below and applies to every session:
@.claude/skills/token/SKILL.md
