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
| Postgres (test) | Isolated DB for real (non-mocked) e2e tests             | -                       | yes (docker)    | yes (docker)       |
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
- E2E tests: real (non-mocked) against a live API. Run only in prod environment (dev + prod VPS), never local. All e2e tests live in `e2e/` (moved out of `packages/frontend`).
- Test DB: separate Postgres instance/database from the primary, reset between e2e runs so tests never touch production data.
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
