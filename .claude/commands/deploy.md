# Deploy Workflow — Local → Dev → Prod

> "Code that doesn't run on Dev doesn't go to Prod."

Two separate environments: **Dev VPS** for smoke testing → confirm OK → **Prod VPS** goes live.

## Must-follow rules:

- **read `packages/infra/vps-info.md` first** for all VPS info (ssh aliases
  `trello-dev-vps` / `trello-prod-vps`, hosts, repo path `/opt/trello`, domains,
  and the deploy command `bash /opt/trello/deploy.sh`). Do not hardcode or guess
  hosts/paths — they come from that file.
- use scp to transfer the file into vps, do not read .env file unless user permitted
- use scp to transfer the certs in packages/infra/certs
- all tests must pass before release prod tag
- all the services must be up during the deployment time so user still has access to the update during deployment
- **before releasing the prod tag you MUST present the full deploy checklist back to the user with each item marked done/not-done, and wait for their explicit approval** (see Phase 3)

# Deploy note

- Build order: packages/shared -> packages/backend -> packages/frontend -> packages/landing

## Flow Overview

```
LOCAL                   GITHUB              DEV VPS               PROD VPS
──────                  ──────              ───────               ────────
git commit
git tag vX.Y.Z-rc.N ──► push tag ──────► git checkout rc.N
                                           make dev
                                           smoke test
                                                │
                                           ✋ Approve
git tag vX.Y.Z ─────────────────────────────────────────────►  git checkout vX.Y.Z
git push tag                                                     make prod
                                                                 make health
```

---

## Phase 1 — Local: Commit + Tag Release Candidate

```bash
git status
git add -p
git commit -m "feat: short summary"

git tag v1.3.0-rc.1        # rc = release candidate, deploys to Dev
git push origin main
git push origin v1.3.0-rc.1
```

**Tag convention:**

| Tag           | Target   | Meaning                          |
| ------------- | -------- | -------------------------------- |
| `v1.3.0-rc.1` | Dev VPS  | Release candidate — under test   |
| `v1.3.0`      | Prod VPS | Stable — approved for production |

---

## Phase 2 — Dev VPS: Smoke Test

```bash
ssh my-vps-dev
cd /opt/trello/Trello_Infra
git pull --tags
git checkout v1.3.0-rc.1

make dev       # docker compose up
make health    # smoke test
```

**Verification checklist:**

- [ ] DB migrations ran without error
- [ ] `GET /health` → `{"status":"ok"}`
- [ ] check if login logout work using mcp
- [ ] all tests are passed including: frontend tests, backend tests, landing tests & e2e tests
- [ ] New feature behaves per spec
- [ ] No regression on existing features

> Dev data: seed/fake only. Never use production data on Dev.

---

## Phase 3 — Gate: Approve to Promote

### 3a. MANDATORY — Report the checklist before tagging

Before creating the stable tag you **MUST** post the full deploy checklist back
to the user, with every item marked and backed by evidence:

- `[x]` = done + verified (show the proof: command output, status code, test
  summary, or the MCP step that confirmed it)
- `[ ]` = not done, skipped, or failed (say which, and why)

Use this exact report format:

```
## Deploy checklist — <env> @ <commit/tag>
- [x] DB migrations ran without error        — <evidence, e.g. "009..021 applied">
- [x] GET /health -> {"status":"ok"}         — <evidence>
- [x] login/logout work (mcp)                — <evidence>
- [x] frontend + backend + landing + e2e tests pass — <counts, e.g. "be 708, fe 350">
- [x] new feature behaves per spec           — <which features, how verified>
- [x] no regression on existing features     — <evidence>
- [x] all services stayed up during deploy   — <evidence>
Outstanding / risks: <anything not [x], or "none">
```

Then **STOP and wait for the user's explicit approval.** Do not create or push
the stable (prod) tag, and do not run the prod deploy, until they approve.
Any unchecked `[ ]` item must be called out explicitly so the user decides
whether to proceed.

### 3b. After approval — create the stable tag from the same commit

```bash
# On local machine
git checkout v1.3.0-rc.1
git tag v1.3.0              # stable — no -rc suffix
git push origin v1.3.0
```

This tag is the manual approval gate. No stable tag = no prod deploy.

---

## Phase 4 — Prod VPS: Deploy Live

```bash
ssh my-vps-prod
cd /opt/trello/Trello_Infra
git pull --tags
git checkout v1.3.0

make prod      # pull images + migrate DB + restart containers
make health    # verify {"status":"ok"}
```

**What `make prod` does:**

1. `docker compose pull` — pull new images
2. `docker compose run migrate` — run pending DB migrations
3. `docker compose up -d` — restart api + nginx (zero-downtime where possible)

---

## Dev vs Prod Comparison

| Aspect    | Dev VPS                      | Prod VPS                     |
| --------- | ---------------------------- | ---------------------------- |
| Purpose   | Test rc tags, QA, smoke test | Serve real users             |
| Tag       | `v1.3.0-rc.N`                | `v1.3.0` (stable only)       |
| Data      | Seed / fake data             | Real data with backups       |
| Domain    | ask owner (Dev VPS IP)       | ask owner (Prod domain)      |
| TLS       | None (HTTP only)             | Let's Encrypt via Cloudflare |
| Log level | `debug`                      | `info`                       |
| Backups   | Not required                 | Daily, off-site              |

---

## Step Summary

| Step           | Where    | Command                       | Purpose                 |
| -------------- | -------- | ----------------------------- | ----------------------- |
| 1. Commit      | Local    | `git commit`                  | Save changes            |
| 2. Tag rc      | Local    | `git tag v1.3.0-rc.1`         | Mark release candidate  |
| 3. Push        | Local    | `git push origin main --tags` | Upload to GitHub        |
| 4. Deploy Dev  | Dev VPS  | `make dev`                    | Start test environment  |
| 5. QA          | Dev VPS  | Manual + `make health`        | Verify correctness      |
| 6. Report+Approve | Local | report checklist → wait → `git tag v1.3.0` | Show checklist status, get approval, then gate for prod |
| 7. Deploy Prod | Prod VPS | `make prod`                   | Ship to users           |
| 8. Verify      | Prod VPS | `make health`                 | Confirm healthy         |
