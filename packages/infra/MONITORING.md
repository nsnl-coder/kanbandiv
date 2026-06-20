# Monitoring runbook

Observability stack: **Loki** (logs) + **Tempo** (traces) + **Prometheus/Grafana**
(metrics) + **Sentry** (errors), correlated by one `traceId`.

> Full query cheatsheets + incident workflow: [.claude/references/how-to-monitor.md](../../.claude/references/how-to-monitor.md)
> Architecture: [.claude/references/logging.md](../../.claude/references/logging.md)

---

## Access

| Tool | URL | Login |
| --- | --- | --- |
| Grafana | `http://<vps-ip>:3000` | `admin` / `GRAFANA_PASSWORD` in `packages/infra/.env` |
| Sentry | org `that-nails-tech` | project `node-express` (BE), `javascript-react` (FE) |
| Health | BE `/health`, `/health/ready` | - |

---

## What's provisioned (versioned in git, deploy = it exists)

### Datasources — `grafana/datasources.yaml`
Loki (`uid: loki`), Tempo (`uid: tempo`), Prometheus (`uid: prometheus`, default).
Loki -> Tempo derived field: click a log's `traceId` to jump to its trace.

### Dashboards — `grafana/dashboards/` (folder "trelloclone" in Grafana)
- **Backend RED** (`red-backend`): request rate, 5xx rate, error %, latency p50/p95/p99, by route. Source metric: `http_request_duration_seconds` (prom-client).
- **Containers & Host (USE)** (`containers-use`): per-container CPU/RAM (cAdvisor), host CPU/mem/disk (node-exporter), targets up.
- **Logs overview** (`logs-overview`): error rate + error/all log panels, with a `service` dropdown (Loki).

### Alert rules — `grafana/alerting/rules.yaml` (folder "trelloclone")
| Rule | Condition |
| --- | --- |
| Backend down | `up{job="backend"} < 1` for 1m |
| 5xx error rate | > 5% for 5m |
| p95 latency | > 1s for 10m |
| Backend error logs | > 10/min for 5m |

> Rules fire into Grafana Alerting. To get **pinged**, add a contact point + notification policy (below).

---

## Wire Slack / Telegram notifications

Rules exist but have no destination yet. In Grafana -> Alerting -> Contact points:
1. Add a contact point (Slack webhook or Telegram bot token + chat id).
2. Alerting -> Notification policies -> set it as default (or route by `severity` label).

To version it instead, add `grafana/alerting/contactpoints.yaml` (provisioned), keeping the
webhook/token in `packages/infra/.env` and referencing it — do not commit the secret.

---

## Add the community dashboards (one-time, via UI)

The exhaustive host/container dashboards are easiest imported by ID (stored in the Grafana
volume, no need to commit their large JSON): Grafana -> Dashboards -> New -> Import:
- **Node Exporter Full**: `1860`
- **cAdvisor / Docker**: `893` (or `19792`)
Pick datasource = Prometheus when prompted.

---

## Daily routine (quick)

- **Sentry**: scan new issues / regressions; compare error rate across `release` (git sha).
- **Grafana**: Backend RED (errors, p95) + Containers/Host (CPU/RAM/disk) + targets up.
- **After deploy**: watch Sentry Release Health for the new sha; `/health/ready` == 200.

## Incident with a traceId
1. **Sentry**: find issue -> stack (source-mapped `.ts`) + `cause`.
2. **Grafana Loki**: `{service="backend"} | json | traceId="<id>"`.
3. Click `traceId` -> **Tempo** waterfall (which span is slow/errored).
4. Fix; commit `Fixes NODE-EXPRESS-<n>` to auto-close in Sentry.

---

## Deploy / change

Dashboards, alerts, datasources are provisioned from these files. After editing:
```
docker compose -f packages/infra/docker-compose.yml up -d grafana
```
Grafana re-reads provisioning on start (dashboards also reload every 30s).

Notes:
- Set `SENTRY_RELEASE=$(git rev-parse --short HEAD)` when deploying so source maps match.
- `/metrics` is internal only (Prometheus scrapes over the Docker network); never expose via nginx.
- Dev retention short (~7d), prod longer (~30d); chunks in Minio.
