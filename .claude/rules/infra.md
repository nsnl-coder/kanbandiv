---
paths:
  - 'packages/infra/**/*'
---

- Do not use docker for local development
- We use postgresql for database

## Infra Services (all required)

| Service         | Description                                             | Local                   | Dev VPS         | Prod VPS           |
| --------------- | ------------------------------------------------------- | ----------------------- | --------------- | ------------------ |
| Nginx           | Reverse proxy / entry point; propagates trace context   | -                       | yes             | yes                |
| Postgres        | Primary database                                        | yes (native, no docker) | yes (docker)    | yes (docker)       |
| Minio           | Object storage for files + Loki/Tempo chunks            | yes                     | yes             | yes                |
| Redis           | Cache / sessions                                        | -                       | yes             | yes                |
| OTel SDK        | Instruments BE + FE; produces `traceId`, exports traces | yes (console exporter)  | yes (-> Tempo)  | yes (-> Tempo)     |
| Vector          | Log agent; collects container logs, forwards to Loki    | -                       | yes             | yes                |
| Loki            | Centralized log store + query                           | -                       | yes             | yes                |
| Tempo           | Distributed trace store; queried by `traceId`           | -                       | yes             | yes                |
| Prometheus      | Metrics store; scrapes app + infra, powers alerts       | -                       | yes             | yes                |
| Grafana         | Dashboards, log/trace/metric queries, alerting          | -                       | yes             | yes                |
| Sentry          | Error + crash tracking (SaaS)                           | disabled                | yes (`staging`) | yes (`production`) |

Notes:

- Local: no docker. Postgres runs natively; observability stack (Vector/Loki/Tempo/Prometheus/Grafana) and Sentry are off. OTel SDK still loads but uses a console exporter.
- E2E tests: real (non-mocked) against the **live deployed site** (dev/prod domain), driving a pre-seeded test user via the real UI. No separate test DB or MinIO - the test account (and unique throwaway sign-up emails) keep runs from disturbing real users. All e2e specs live in `e2e/` (moved out of `packages/frontend`).
- Runner: Playwright runs directly, **no Docker**. Because the specs hit the public URL, they run from anywhere with network access - locally, on the VPS, or in CI - with `pnpm --filter e2e-frontend e2e` (run `npx playwright install chromium` once first). `E2E_BASE_URL` + the `E2E_*` test-account creds + `MAILTRAP_API_TOKEN` come from `packages/infra/.env` on the VPS, or from your shell/`.env` when running locally.
- OTP-dependent flows (sign-up/verify/forgot) read codes from the **Mailtrap sandbox**, which both dev and prod use for outbound mail.
- Dev + Prod VPS: full stack via docker compose. Same config; Dev uses shorter log/trace retention (7d vs 30d).
- Three pillars: Loki (logs) + Tempo (traces) + Prometheus (metrics).
- `traceId` is the OpenTelemetry trace id, shared across logs, traces, and Sentry.
- Backend exposes `/health` (liveness) + `/health/ready` (readiness) + `/metrics` (Prometheus).
- Deferred (not yet required): Alertmanager, OTel Collector, Pyroscope, Grafana Faro. See [.claude/references/logging.md](../references/logging.md) section 12.
- See logging details in [.claude/references/logging.md](../references/logging.md) if needed

## Infra Folder Structure

```txt
  /grafana                                  # grafana config file
  /loki                                     # loki config file
  /prometheus                               # prometheus config file
  /docker                                   # docker config file
  /tempo                                    # tempo config file
  /vector                                   # vector config file
  /nginx                                    # nginx config file
  /deploy-scripts                           # contain deploy scripts
  vps-info.md                               # contain dev vps, prod vps info, should be ignored

```

## Domain rule

All public services sit behind the nginx `proxy` on per-tier subdomains of
`trello-clone.shop`, fronted by Cloudflare (proxied/orange-cloud, SSL mode Full
strict). The wildcard Cloudflare Origin CA cert (`*.trello-clone.shop`) covers
every subdomain on both tiers.

| Service  | Prod                       | Dev                            |
| -------- | -------------------------- | ------------------------------ |
| frontend | `app.trello-clone.shop`    | `dev-app.trello-clone.shop`    |
| backend  | `api.trello-clone.shop`    | `dev-api.trello-clone.shop`    |
| landing  | `trello-clone.shop` (apex) | `dev.trello-clone.shop`        |
| grafana  | `grafana.trello-clone.shop`| `dev-grafana.trello-clone.shop`|
| minio    | `minio.trello-clone.shop`  | `dev-minio.trello-clone.shop`  |

- Each `*_DOMAIN` is set in `packages/infra/.env` on the box; the proxy template
  (`packages/infra/proxy/default.conf.template`) renders one server block per
  domain via nginx envsubst (`NGINX_ENVSUBST_FILTER=DOMAIN`).
- Adding a subdomain = add a DNS A record (proxied) -> VPS IP + a `*_DOMAIN`
  env + a server block. db/redis are never given a domain (internal only).

## How to set up Minio in dev vps & prod vps

The MinIO **admin console** (`:9001`) is published at the `minio` subdomain via
the proxy; the S3 API (`:9000`) stays internal (backend backup + Loki/Tempo
chunks only — no browser/presigned access).

1. DNS: proxied A record `minio` (prod) / `dev-minio` (dev) -> VPS IP.
2. `packages/infra/.env`: `MINIO_DOMAIN=...`, plus `MINIO_ACCESS_KEY` /
   `MINIO_SECRET_KEY` (these are the console root login).
3. compose sets `MINIO_BROWSER_REDIRECT_URL=https://${MINIO_DOMAIN}` so console
   redirects/login work behind the proxy.
4. Access is **admin-gated by SSO** (see Grafana section): only a super-admin app
   session reaches the console; MinIO then prompts for its own root creds (it has
   no header-trust/auto-login mode).
5. Deploy: `bash /opt/trello/deploy.sh`.

## How to set up grafana in dev vps & prod vps

Grafana is published at the `grafana` subdomain with **admin SSO single sign-on**
(no Grafana login for super-admins).

1. DNS: proxied A record `grafana` (prod) / `dev-grafana` (dev) -> VPS IP.
2. `packages/infra/.env`: `GRAFANA_DOMAIN=...`, `GRAFANA_PASSWORD` (fallback
   login), `TELEGRAM_BOT_TOKEN` (alert contact point; chat id is hardcoded in
   `grafana/alerting/contactpoints.yaml` because Grafana mis-types an all-digit
   env value as a number and crashes provisioning).
3. compose sets `GF_SERVER_ROOT_URL`/`GF_SERVER_DOMAIN` and the auth-proxy:
   `GF_AUTH_PROXY_ENABLED`, header `X-WEBAUTH-User`, `GF_AUTH_PROXY_WHITELIST`
   = the proxy's pinned IP `172.28.0.10` (network dynamic range is confined to
   `172.28.1.0/24` so the static IP never collides). `GF_USERS_AUTO_ASSIGN_ORG_ROLE=Admin`.
4. SSO flow (forward-auth): proxy `auth_request` -> backend `/api/sso/verify`;
   missing cookie -> bounce to `app.` `/api/sso/authorize` (verifies super-admin
   from the app session) -> host-bound token -> `/__sso/callback` sets a
   per-host SSO cookie -> Grafana auto-logs-in from `X-WEBAUTH-User`.
5. Still loopback-bound on `127.0.0.1:3000` for SSH-tunnel fallback.
6. Deploy: `bash /opt/trello/deploy.sh`.
