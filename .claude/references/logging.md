# Production-Ready Logging Plan

> Centralized logging, tracing, monitoring, and error tracking for the monorepo.
> Stack: OpenTelemetry (instrumentation) + Pino (backend logger) + Vector + Loki
> (logs) + Tempo (traces) + Prometheus (metrics) + Grafana (view/alert)
>
> - Sentry (errors), Minio for long-term storage.
>   Three pillars: logs (Loki), traces (Tempo), metrics (Prometheus).

---

## 1. Objectives

- Detect issues early, before user reports.
- Trace a full request via `traceId` (`X-Request-ID`).
- Spot slow queries and slow API responses.
- Cut debug time with rich context + breadcrumbs.

---

## 2. Architecture

Two flows:

1. **Logging** - all service logs collected, centralized, stored long-term.
2. **Error tracking** - exceptions/crashes sent directly to Sentry.

### Components

| Component            | Role                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| OpenTelemetry SDK    | Instruments BE + FE; produces `traceId`/`spanId`, propagates W3C `traceparent` |
| Application (BE, FE) | Generates logs + traces; sends errors to Sentry                                |
| Nginx                | Entry point; propagates trace context; logs access                             |
| Postgres             | DB; logs slow queries                                                          |
| Redis, Minio         | Cache/storage; logs errors + warnings                                          |
| Vector               | Agent; collects container logs, forwards to Loki                               |
| Loki                 | Centralized log store + query (indexes labels only)                            |
| Tempo                | Distributed trace store; queried by `traceId`, chunks in Minio                 |
| Prometheus           | Metrics store; scrapes app + infra, powers SLO/latency alerts                  |
| Minio (reused)       | Loki + Tempo chunk storage (object storage)                                    |
| Grafana              | Dashboards, queries, alerting; correlates logs <-> traces <-> metrics          |
| Sentry               | Error tracking; exceptions + breadcrumbs                                       |

---

## 3. Data Flow

```text
[User]
  -> [Nginx]            propagate trace context, log access
  -> [Backend]          OTel span, log with traceId
  -> [DB / Redis / Minio]   log errors or slow queries

Logs:    container stdout/stderr -> [Vector] -> [Loki]  -> chunks [Minio]
Traces:  OTel SDK (BE + FE)      -> OTLP     -> [Tempo] -> chunks [Minio]
Metrics: app /metrics + exporters <- scrape  <- [Prometheus]

[Grafana] queries Loki + Tempo + Prometheus, correlates by traceId, alerts.
```

Plus: all BE + FE exceptions go directly to **Sentry** (carry `traceId` for cross-reference).

---

## 4. Component Details

### 4.0 OpenTelemetry (required, always on for VPS)

- Standard instrumentation for BE + FE. Produces `traceId` / `spanId`, propagates
  W3C `traceparent` header across services.
- `traceId` = OTel trace id. This is the single id used in logs, traces, and Sentry.
- Exporter: OTLP -> Tempo (traces). Auto-instrumentation for HTTP, Postgres, Redis.
- Replaces the old raw `$request_id` approach; we always wire OTel.

### 4.1 Nginx

- Log format: JSON (easy Vector parsing).
- **Trace context**: pass through W3C `traceparent` header to backend; if absent,
  fall back to `$request_id` so the edge always has an id.
- Echo the id in the response (`X-Request-ID`) so the frontend can capture it.
- Write logs to `stdout` / `stderr`.

### 4.2 Backend (Node.js)

- **OTel SDK**: initialized before app code (see 6.2.0); auto-creates a server span
  per request and propagates context.
- **Logger: Pino** (chosen over Winston for speed + native JSON). JSON output on
  VPS, `pino-pretty` locally. Single shared instance (see 6.2); no `console.log`.
- **traceId in logs**: a Pino mixin reads the active OTel span context and injects
  `traceId` / `spanId` into every line (see 6.2). Ties logs to traces in Grafana.
- Required fields: `timestamp`, `level`, `traceId`, `service: 'backend'`, `userId` (if available).
- Log every request: method, path, status, responseTime.
- Log errors with stack trace + request context.
- Log slow queries / external API calls.
- **PII scrubbing in code**: Pino `redact` paths strip secrets at the logger
  (see 6.2). Policy alone is not enough; enforce in the pipeline.

### 4.3 Frontend

- **OTel web SDK**: instruments fetch/XHR, injects `traceparent` into API calls so
  FE and BE spans join one trace.
- **FE OTLP endpoint**: the browser cannot reach the internal `tempo:4318`. Export
  FE traces to a public Nginx path (`https://monitoring.domain.com/otlp`) that proxies
  to Tempo, with CORS enabled (see 6.3). BE keeps the internal hostname.
- Sentry SDK: report errors + crashes with breadcrumbs.
- **traceId capture**: read the trace id (from OTel context / `X-Request-ID`),
  attach to the Sentry scope (`Sentry.setTag('traceId', id)`) and `/api/client-log`.
  Closes the FE -> BE -> Sentry loop.
- Behavior logs (non-errors): send to backend via `/api/client-log`, backend writes to Loki.
- Do NOT use Sentry for behavior logs.
- **`/api/client-log` hardening**: require auth, rate-limit per IP/user, cap
  payload size, allowlist fields. Otherwise it is an open log-injection / flood endpoint.

### 4.4 Postgres

- `log_min_duration_statement = 200ms` (log queries > 200ms).
- Logs to `stdout` for Vector.

### 4.5 Redis + Minio

- Log only `error` / `warning` level (avoid flooding).

### 4.6 Vector (replaces Promtail, which is EOL)

- Lightweight Rust agent, runs as container.
- Reads all container `stdout` / `stderr`, sends to Loki.
- Watch via Docker logs driver or file reading.
- **Stable labels**: do NOT parse `service` from container name with regex
  (brittle for `project_backend_1`). Set an explicit Compose `labels:` block per
  service and read it in Vector (see 6.5). Labels: `service`, `env`, `container_name`.
  Keep labels low-cardinality ONLY; `traceId`/`userId` stay in the log line (queried
  via `| json`), never as labels.
- **PII scrubbing**: a `remap` step drops known secret fields as a second line of
  defence. This + Pino redact are both top-level/shallow; under strict compliance,
  switch to a field _allowlist_ (keep known-safe keys, drop the rest) instead of a denylist.

### 4.7 Loki

- Runs as a container service.
- Storage: index on local disk; chunks in Minio (long-term, restart-safe).
- **Retention**: Loki cannot retain by log _level_. Start with one global window
  (30d). For tiered retention, split into streams via a `retention` label
  (`short` | `long`) and set per-stream rules in `limits_config`.
- API port: 3100.

### 4.8 Grafana

- Datasources: Loki + Tempo + Prometheus + Sentry (plugin).
- Dashboards: logs by `traceId`, traces by service, metrics (RED/USE), errors over time.
- Enable Loki "derived field" -> Tempo so a log's `traceId` links to its trace.
- Alert rules (SLO-based, not just thresholds):
  - Error rate (errors / total requests) with burn-rate alerts.
  - Slow query > 2s.
  - API p95 latency regression > 30%.
  - Absolute count (> 5 errors/min) only for low-traffic services.
- Send alerts via Slack / Telegram.

### 4.9 Sentry (SaaS)

- SDK for backend + frontend.
- Environments: `production`, `staging`, `development`.
- Alert: new error, or affected users > 5 in 5 min.
- Release Health: error rate by deploy version.
- **Quota guard**: free tier is 5k events/mo (8). Set `sampleRate` + `tracesSampleRate`
  < 1 and client-side dedupe so one error storm does not exhaust the month.
- **Source maps (required)**: prod bundles are minified, so Sentry stack traces are
  useless without source maps. Generate them at build and **upload to Sentry**, tied to
  a `release` (git sha) that matches `Sentry.init({ release })`.
  - **Frontend**: `@sentry/vite-plugin` (`build.sourcemap: true`) uploads then
    `sourcemaps.filesToDeleteAfterUpload` removes the `.map` from `dist`.
  - **Backend**: `tsc` `sourceMap: true` + `sentry-cli sourcemaps inject && upload`,
    then strip `.map` from the runtime image.
  - **NEVER serve `.map` to the client.** Maps reveal full source. Delete them from the
    bundle after upload (plus a `find dist -name '*.map' -delete` safety net) so nginx
    never serves them; maps live only in Sentry. Source maps are useless when the stack
    has no first-party frame (e.g. a library throws across an async boundary) - wrap and
    re-throw a `TRPCError` so your own frame is on the stack, and capture that error
    (not its `cause`) so the source-mapped frame is the culprit.
  - **Auth token**: use a Sentry **Organization Token** (scope `org:ci`) passed via a
    BuildKit secret at build time, never baked into an image layer or committed.

### 4.10 Tempo

- Distributed trace store; receives OTLP spans from the OTel SDKs.
- Runs as a container service. Chunks stored in Minio (same as Loki).
- Queried in Grafana by `traceId`; "Logs to Traces" links Loki <-> Tempo.
- Retention: align with logs (Dev 7d, Prod 30d).
- Ports: OTLP gRPC 4317, OTLP HTTP 4318, query 3200.

### 4.11 Prometheus (required)

- Metrics store; scrapes targets on an interval (pull model).
- Backend exposes `/metrics` (e.g. `prom-client`): request rate, latency histograms,
  error counts, plus OTel metrics. This is what powers the SLO alerts in 4.8.
- **Keep `/metrics` internal**: scrape over the Docker network only; never expose it
  through public Nginx (it leaks traffic shape + endpoint inventory).
- Scrape infra exporters: `node-exporter` (host), `cAdvisor` (containers),
  Postgres/Redis exporters as needed.
- Storage: local TSDB; retention 15d (tune per disk). Long-term optional later.
- Port: 9090. Grafana adds it as a datasource.

### 4.12 Health Checks

- **Backend `/health` (liveness)**: returns `200 { status: 'ok' }`. No deps checked.
  Used by Docker `HEALTHCHECK` and Nginx upstream checks.
- **Backend `/health/ready` (readiness)**: checks Postgres, Redis, Minio reachable;
  returns `200` only when all pass, else `503` with the failing dependency.
- Do NOT log every health probe (floods logs). Set these routes to log only on failure.
- Each infra container declares its own Compose `healthcheck` so `depends_on:
condition: service_healthy` gates startup order.
- Uptime alerting: Grafana (or external monitor) pings `/health` on an interval;
  alert if non-200 for > 1 min.

---

## 5. Environment Strategy

| Env      | Log Format             | Level   | Sentry                | OTel / Tempo                        | Loki + Grafana         | Log Storage          |
| -------- | ---------------------- | ------- | --------------------- | ----------------------------------- | ---------------------- | -------------------- |
| Local    | pretty (`pino-pretty`) | `debug` | Disabled              | SDK on, console exporter (no Tempo) | Not running            | `stdout` console     |
| Dev VPS  | JSON                   | `debug` | On (tag `staging`)    | Export to Tempo                     | Running, test pipeline | Minio (7d retention) |
| Prod VPS | JSON                   | `info`  | On (tag `production`) | Export to Tempo                     | Running, uses Minio    | Persistent in Minio  |

Trace sampling (`OTEL_TRACES_SAMPLER_ARG`): `1.0` Local/Dev VPS, ~`0.1` Prod VPS.

---

## 6. Implementation Guide

### 6.1 Folder Structure

```text
packages/
  backend/src/
    logger.ts                      # Pino config (+ OTel trace mixin)
    tracing.ts                     # OTel SDK init (loaded first)
  frontend/src/
    sentry.ts                      # Sentry config
    tracing.ts                     # OTel web SDK init
  shared/types/logger.types.ts     # Log payload types
  infra/
    docker/
      docker-compose.prod.yml
      docker-compose.dev.yml
    nginx/nginx.conf
    loki/loki-config.yaml
    tempo/tempo-config.yaml
    prometheus/prometheus.yml
    grafana/datasources.yaml
    vector/vector.toml
```

### 6.2.0 OTel SDK Init (loaded before app code)

```typescript
// backend/src/tracing.ts  -- import at the very top of the entrypoint
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';

const hasTempo = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
// Sample rate: 1.0 local/dev, ~0.1 prod (set OTEL_TRACES_SAMPLER_ARG). 100% spans to
// Tempo is costly at prod traffic; head sampling here until the OTel Collector (s12).
const ratio = Number(process.env.OTEL_TRACES_SAMPLER_ARG ?? 1);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    'service.name': 'backend',
    'deployment.environment': process.env.NODE_ENV,
  }),
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(ratio),
  }),
  // Local: ConsoleSpanExporter prints spans to stdout (undefined = no output).
  // VPS: OTLPTraceExporter reads OTEL_EXPORTER_OTLP_ENDPOINT (Tempo 4318).
  traceExporter: hasTempo ? new OTLPTraceExporter() : new ConsoleSpanExporter(),
  // OTel metrics on /metrics (port 9464) only on VPS; skip the local server.
  metricReader: hasTempo ? new PrometheusExporter({ port: 9464 }) : undefined,
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

### 6.2 Backend Logger (Pino + redact + trace context)

```typescript
import { trace } from '@opentelemetry/api';

const logger = pino({
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty' }
      : undefined,
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'backend', env: process.env.NODE_ENV },
  // PII scrubbing enforced at the logger, not by policy.
  // NOTE: pino wildcards are shallow (`*.x` = depth 2 only). Deeply nested
  // secrets are caught by the Vector remap (6.5) as the second line of defence.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'accessToken',
      'refreshToken',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.creditCard',
      '*.cardNumber',
    ],
    censor: '[REDACTED]',
  },
  // Inject the active OTel span ids into every log line.
  mixin() {
    const span = trace.getActiveSpan()?.spanContext();
    return span ? { traceId: span.traceId, spanId: span.spanId } : {};
  },
});
```

### 6.2.1 Edge Header (Nginx echo)

OTel auto-instrumentation creates the server span and propagates context; no manual
`AsyncLocalStorage` is needed. Nginx already echoes `X-Request-ID` (6.3), so this
middleware is only needed if you terminate without Nginx (e.g. local) - pick one,
don't set the header in both places:

```typescript
import { trace } from '@opentelemetry/api';

export function echoTraceId(req, res, next) {
  const id = trace.getActiveSpan()?.spanContext().traceId;
  if (id) res.setHeader('X-Request-ID', id);
  next();
}
```

### 6.3 Nginx

```nginx
# Extract the bare trace-id (2nd field of W3C traceparent: version-traceId-spanId-flags)
# so nginx, backend, and Tempo all share ONE id format. Fall back to $request_id.
map $http_traceparent $trace_id {
  "~^[0-9a-f]{2}-(?<tid>[0-9a-f]{32})-" $tid;
  default                               $request_id;
}

log_format main_json escape=json '{ ... "traceId": "$trace_id" }';
access_log /dev/stdout main_json;
error_log /dev/stderr;
proxy_set_header traceparent $http_traceparent;   # pass W3C trace context unchanged
proxy_set_header X-Request-ID $trace_id;           # normalized id at the edge
add_header X-Request-ID $trace_id always;          # return to frontend
```

Public OTLP path so the browser FE can ship traces to Tempo (CORS + preflight):

```nginx
# on monitoring.domain.com (auth-gated vhost)
location /otlp/ {
  if ($request_method = OPTIONS) {
    add_header Access-Control-Allow-Origin "https://app.domain.com";
    add_header Access-Control-Allow-Headers "content-type,traceparent";
    add_header Access-Control-Max-Age 86400;
    return 204;
  }
  add_header Access-Control-Allow-Origin "https://app.domain.com" always;
  proxy_pass http://tempo:4318/;   # OTLP HTTP
}
```

### 6.4 Loki (chunks in Minio)

```yaml
# v13 pairs with the tsdb index store (boltdb-shipper is legacy).
# shared_store was removed; storage lives under storage_config / common now.
# ${MINIO_*} only expands if Loki starts with `-config.expand-env=true` (see 6.6).
schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: s3
      schema: v13
      index:
        prefix: index_
        period: 24h

storage_config:
  tsdb_shipper:
    active_index_directory: /loki/tsdb-index
    cache_location: /loki/tsdb-cache
  aws:
    s3: http://minio:9000/loki-data # bucket in the path; path-style for Minio
    s3forcepathstyle: true
    access_key_id: ${MINIO_ACCESS_KEY}
    secret_access_key: ${MINIO_SECRET_KEY}

limits_config:
  retention_period: 720h # 30d global; tier via stream labels if needed

compactor:
  working_directory: /loki/compactor
  retention_enabled: true
  delete_request_store: s3 # replaces the old shared_store key
```

### 6.4.1 Tempo (traces, chunks in Minio)

```yaml
# ${MINIO_*} only expands if Tempo starts with the env-expansion flag (see 6.6).
distributor:
  receivers:
    otlp:
      protocols:
        grpc: # 4317
        http: # 4318

storage:
  trace:
    backend: s3
    s3:
      endpoint: minio:9000
      bucket: tempo-data
      insecure: true
      forcepathstyle: true
      access_key: ${MINIO_ACCESS_KEY}
      secret_key: ${MINIO_SECRET_KEY}

compactor:
  compaction:
    block_retention: 720h # 30d prod; 168h (7d) on dev
```

Export endpoints differ by runtime:

- **Backend** (container): `OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318` (internal).
- **Frontend** (browser): `https://monitoring.domain.com/otlp` -> Nginx -> Tempo. The
  internal hostname is unreachable from the browser and would hit CORS.

Tempo also needs CORS allowed on its OTLP HTTP receiver for the FE preflight:

```yaml
distributor:
  receivers:
    otlp:
      protocols:
        http:
          cors:
            allowed_origins:
              - https://app.domain.com
```

### 6.4.2 Prometheus (scrape config)

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: backend # prom-client: request rate/latency/errors
    metrics_path: /metrics
    static_configs:
      - targets: ['backend:3000']
  - job_name: backend-otel # OTel PrometheusExporter (tracing.ts, port 9464)
    metrics_path: /metrics
    static_configs:
      - targets: ['backend:9464']
  - job_name: node
    static_configs:
      - targets: ['node-exporter:9100']
  - job_name: cadvisor
    static_configs:
      - targets: ['cadvisor:8080']
```

Backend exposes `/metrics` via `prom-client` (default + custom request histograms).

### 6.5 Vector (explicit Compose labels)

```toml
[sources.docker_logs]
type = "docker_logs"   # or "file" if not using Docker driver

[transforms.add_labels]
type = "remap"
source = '''
# Read explicit Compose labels, not a brittle container-name regex.
.service = .label."com.project.service" || "unknown"
.env = .label."com.project.env" || "production"

# App logs arrive as a JSON string in .message; parse before scrubbing,
# otherwise del() on top-level fields is a no-op. Skip non-JSON lines so we
# don't clobber plain-text output with "{}".
parsed, err = parse_json(.message)
if err == null {
  del(parsed.password); del(parsed.token); del(parsed.authorization)
  del(parsed.accessToken); del(parsed.refreshToken)
  .message = encode_json(parsed)
}
'''

[sinks.loki]
type = "loki"
inputs = ["add_labels"]
endpoint = "http://loki:3100"

[sinks.loki.labels]
service = "{{ service }}"
env = "{{ env }}"
```

Set the labels on each service in Compose:

```yaml
backend:
  labels:
    com.project.service: backend
    com.project.env: production
```

### 6.6 Production Docker Compose

```yaml
services:
  backend: ...
  postgres: ...
  nginx: ...
  # One-shot: create the object-storage buckets before Loki/Tempo start.
  createbuckets:
    image: minio/mc
    entrypoint: >
      /bin/sh -c "
      mc alias set m http://minio:9000 $MINIO_ACCESS_KEY $MINIO_SECRET_KEY;
      mc mb -p m/loki-data m/tempo-data; exit 0"
    depends_on: [minio]
  loki:
    image: grafana/loki:latest
    command: -config.file=/etc/loki/loki-config.yaml -config.expand-env=true
    depends_on: [createbuckets]
  tempo:
    image: grafana/tempo:latest
    # tempo expands env when started with: -config.expand-env=true
    command: -config.file=/etc/tempo/tempo-config.yaml -config.expand-env=true
    depends_on: [createbuckets]
    # ports: 4317 (OTLP gRPC), 4318 (OTLP HTTP), 3200 (query)
  prometheus:
    image: prom/prometheus:latest
    # port: 9090; scrapes backend /metrics + exporters (internal network only)
  grafana:
    image: grafana/grafana:latest
    # ...
  vector:
    image: timberio/vector:latest
    # ...
```

---

## 7. Debug Process with TraceId

1. User reports error, provides `traceId`.
2. Grafana -> Loki -> query `{service="backend"} | json | traceId="xxx"` for related
   logs (Nginx, backend, slow SQL). NOTE: `traceId` is a line filter, never a stream
   label (high-cardinality labels break Loki).
3. Click the log's `traceId` -> jump to the full trace in Tempo (span timeline, latency).
4. Check Sentry with same `traceId` for stack trace + breadcrumbs.
5. Identify root cause, fix.

---

## 8. Estimated Resources

| Component  | CPU       | RAM     |
| ---------- | --------- | ------- |
| Loki       | ~0.1 core | ~128 MB |
| Tempo      | ~0.1 core | ~256 MB |
| Prometheus | ~0.2 core | ~512 MB |
| Grafana    | ~0.5 core | ~512 MB |
| Vector     | ~0.1 core | <150 MB |
| Total      | ~1.5 core | ~1.7 GB |

- Sentry: free tier (5k events/month).
- Minio: reused, no extra cost.

## 10. Security

- Never log secrets: passwords, tokens, card numbers, etc.
- Grafana behind Nginx subdomain (e.g. `monitoring.yourdomain.com`), strong auth, IP allowlist if possible.
- Sentry: privacy settings to scrub PII unless needed.

---

## 11. Key Takeaways

- OpenTelemetry instruments everything; one `traceId` across logs, traces, errors.
- Three pillars: Loki (logs) + Tempo (traces) + Prometheus (metrics).
- Vector ships logs; Grafana views, correlates, and alerts across all three.
- Sentry for errors + crashes; upload source maps (BE + FE) but never serve `.map` to the client.
- Minio for long-term log + trace storage.
- Roll out in phases; tune alerts to fit the project.

---

## 12. Deferred / Future

Not in the initial build; add when needed:

- **Alertmanager** - dedupe, group, route, and silence alerts from Prometheus/Grafana
  (Slack/Telegram), with on-call schedules + inhibition. Until then, Grafana's
  built-in alerting handles routing.
- **OTel Collector** - central OTLP pipeline (sample/batch/fan-out) instead of each
  app exporting straight to Tempo.
- **Pyroscope** - continuous profiling, linked to traces.
- **Grafana Faro** - frontend RUM (web vitals, FE traces).
- **Uptime Kuma** / synthetic monitoring - external availability checks.
