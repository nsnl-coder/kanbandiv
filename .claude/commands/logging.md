# /logging — Build & maintain the observability stack

Manual command. Use when setting up or extending **logging + tracing + metrics +
error tracking** for a project. Self-contained playbook: fixed stack, working
configs, hard-won gotchas, and a verification checklist. Read the relevant section,
copy the config, then run the verification at the end. Do not invent alternatives to
the stack.

> Build-tool agnostic: examples use generic `build` / `install` steps. Swap in your
> package manager (npm/pnpm/yarn) and bundler as-is — the observability wiring does
> not depend on them. The one monorepo caveat is in section 6 (build internal shared
> packages before the app, inside the image).

---

## 1. The stack (fixed — do not substitute)

| Concern | Tool | Why this one |
| --- | --- | --- |
| Instrumentation | **OpenTelemetry** SDK (BE + FE) | One `traceId`/`spanId` across logs, traces, errors; auto-instruments http/pg/redis |
| Backend logger | **Pino** | Fastest Node logger, native JSON, redact + mixin |
| Log shipper | **Vector** | Rust agent; Promtail is EOL |
| Logs store | **Loki** | Cheap, labels-indexed, chunks in object storage |
| Traces store | **Tempo** | OTLP-native, chunks in object storage |
| Metrics | **Prometheus** + `prom-client` | Pull model, powers SLO alerts |
| Dashboards/alerts | **Grafana** | Correlates all three pillars; provisioned alerting |
| Errors | **Sentry** (SaaS) | Stack traces + source maps + release health |
| Object storage | **Minio** | Loki + Tempo chunks (reuse existing) |

Three pillars: **Loki (logs) + Tempo (traces) + Prometheus (metrics)**. Errors go
**directly to Sentry**. Everything is keyed by `traceId` (the OTel trace id, echoed
to the browser as `X-Request-ID`).

---

## 2. Environment model (one knob)

A single `VPS_ENV` of `local | dev | prod` drives everything. Derive `NODE_ENV`,
log level, sampling, Sentry env, exporters from it — never set those by hand.

| `VPS_ENV` | Log format | Level | Sentry | OTel exporter | Stack | Sampling | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| local | pino-pretty | debug | off | console | off (native pg only) | 1.0 | — |
| dev | JSON | debug | on (`dev`) | OTLP -> Tempo | full (docker) | 1.0 | 7d |
| prod | JSON | info | on (`prod`) | OTLP -> Tempo | full (docker) | 0.1 | 30d |

```ts
// config: derive everything from VPS_ENV; secrets are always required (no env-gated default)
const vpsEnv = (process.env.VPS_ENV ?? "local") as "local" | "dev" | "prod";
const isLocal = vpsEnv === "local";
const LOG_LEVEL = process.env.LOG_LEVEL || (vpsEnv === "prod" ? "info" : "debug");
const OTEL_SAMPLE_RATIO = vpsEnv === "prod" ? 0.1 : 1;
```

Runtime env passed to the backend container: `VPS_ENV`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318`,
`REDIS_URL`, `MINIO_ENDPOINT`, `SENTRY_DSN`, `SENTRY_RELEASE`, plus app secrets via an
env file. All observability env vars are **optional with empty defaults** so `local`
runs with zero config (console exporter, Sentry disabled, readiness skips absent deps).

---

## 3. Backend implementation

### 3.1 `tracing.ts` — import FIRST, before express/pg/http

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ConsoleSpanExporter, ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";

const vpsEnv = process.env.VPS_ENV ?? "local";
process.env.NODE_ENV = vpsEnv === "local" ? "development" : "production"; // for libraries only
const hasTempo = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const ratio = vpsEnv === "prod" ? 0.1 : 1;

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ "service.name": "backend", "deployment.environment": vpsEnv }),
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
  traceExporter: hasTempo ? new OTLPTraceExporter() : new ConsoleSpanExporter(),
  metricReader: hasTempo ? new PrometheusExporter({ port: 9464 }) : undefined,
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
process.on("SIGTERM", () => void sdk.shutdown().finally(() => process.exit(0)));
```

Entrypoint: `import "./tracing.js"; import "./sentry.js";` must be the first two lines.

### 3.2 `logger.ts` — Pino + redact + trace mixin

```ts
import { pino } from "pino";
import { trace } from "@opentelemetry/api";

export const logger = pino({
  level: LOG_LEVEL,
  transport: isLocal ? { target: "pino-pretty" } : undefined, // JSON on any VPS
  base: { service: "backend", env: vpsEnv },
  redact: { paths: [
    "req.headers.authorization", "req.headers.cookie",
    "password", "token", "accessToken", "refreshToken",
    "*.password", "*.token", "*.accessToken", "*.refreshToken",
    "*.creditCard", "*.cardNumber",
  ], censor: "[REDACTED]" },
  mixin() {
    const s = trace.getActiveSpan()?.spanContext();
    return s ? { traceId: s.traceId, spanId: s.spanId } : {};
  },
});
```

No `console.log` anywhere. Pino wildcards are shallow (depth 2) — Vector remap (5.x)
is the second line of defence for deeply nested secrets.

### 3.3 Request logging, /metrics, health

- `pino-http` logs every request; **ignore `/metrics` and `/health*`** (probes flood Loki).
- `prom-client`: a `http_request_duration_seconds` histogram (labels `method`, `route`,
  `status`) + default metrics, served at `/metrics` on the app port. Keep `/metrics`
  internal (scraped over the docker network) — never expose via nginx.
- `/health` (liveness): `200 {status:"ok"}`, no deps. `/health/ready`: check Postgres
  always; check Redis/Minio only when their URL is configured (so `local` stays green).
  Log readiness only on failure.

### 3.4 Sentry + error capture (the part everyone gets wrong)

```ts
// sentry.ts
Sentry.init({
  dsn: env.SENTRY_DSN,                 // empty -> disabled
  environment: vpsEnv,
  release: env.SENTRY_RELEASE || undefined, // git sha; MUST match uploaded source maps
  tracesSampleRate: 0.1,
  skipOpenTelemetrySetup: true,        // our NodeSDK is the single OTel provider
});
```

tRPC (and most frameworks) **catch handler throws and serialize them into the response**,
so the request logger only sees a generic 500. Add an `onError` hook on the adapter:

```ts
function reportError({ error, path, type }) {
  if (error.code !== "INTERNAL_SERVER_ERROR") return; // expected 4xx stay quiet
  logger.error({ err: error, cause: error.cause, path, type }, "internal error");
  // Capture the THROWN error (keeps your source-mapped frame); Sentry follows
  // error.cause to also show the underlying error. Do NOT capture `cause` alone.
  if (sentryEnabled) Sentry.captureException(error);
}
```

When a library throws across an async boundary (e.g. nodemailer SMTP), the stack has
**no first-party frame** — wrap and re-throw so your frame is the culprit:

```ts
try { await sendMail(...); }
catch (cause) { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "EMAIL_SEND_FAILED", cause }); }
```

---

## 4. Frontend implementation

- **OTel web SDK** (`tracing.ts`): `WebTracerProvider` + `BatchSpanProcessor`, fetch +
  XHR instrumentation with `propagateTraceHeaderCorsUrls` = your API origin, so FE and
  BE spans join one trace. Browser can't reach `tempo:4318` — export to a public nginx
  path (`/otlp` -> Tempo). No endpoint -> `ConsoleSpanExporter` (local).
- **Sentry** (`sentry.ts`): empty DSN -> disabled; `browserTracingIntegration`,
  `tracesSampleRate < 1`. DSN is public (ships in the bundle).
- Import `tracing` + `sentry` first in `main.tsx`.
- Behaviour logs (non-errors) -> `POST /api/client-log` (auth + CSRF + rate-limit +
  payload cap + field allowlist) -> backend writes to Loki. Errors go to Sentry, never here.

---

## 5. Infra configs (the working versions)

### 5.1 Nginx

```nginx
map $http_traceparent $trace_id {
  "~^[0-9a-f]{2}-(?<tid>[0-9a-f]{32})-" $tid;
  default                               $request_id;
}
log_format main_json escape=json '{"time":"$time_iso8601","service":"nginx","status":$status,"path":"$uri","responseTime":$request_time,"traceId":"$trace_id"}';
# shared proxy headers + trace context:
proxy_set_header traceparent $http_traceparent;
proxy_set_header X-Request-ID $trace_id;
add_header X-Request-ID $trace_id always;          # FE captures it
location /otlp/ { proxy_pass http://tempo:4318/; } # same-origin -> no CORS needed
location /metrics { return 404; }                  # never expose metrics publicly
```

### 5.2 Loki (explicit s3 fields — NOT the inline DSN)

```yaml
# MINIO_* env vars expand only with -config.expand-env=true.  <-- never write ${...} in a comment
auth_enabled: false
schema_config:
  configs: [{ from: 2024-01-01, store: tsdb, object_store: s3, schema: v13, index: { prefix: index_, period: 24h } }]
storage_config:
  tsdb_shipper: { active_index_directory: /loki/tsdb-index, cache_location: /loki/tsdb-cache }
  aws:
    endpoint: minio:9000
    bucketnames: loki-data
    access_key_id: ${MINIO_ACCESS_KEY}
    secret_access_key: ${MINIO_SECRET_KEY}
    s3forcepathstyle: true
    insecure: true
    region: us-east-1
limits_config: { retention_period: 720h }     # 168h on dev
compactor: { working_directory: /loki/compactor, retention_enabled: true, delete_request_store: s3 }
```

### 5.3 Tempo

```yaml
distributor: { receivers: { otlp: { protocols: { grpc: {}, http: { cors: { allowed_origins: ["*"] } } } } } }
storage: { trace: { backend: s3, s3: { endpoint: minio:9000, bucket: tempo-data, insecure: true, forcepathstyle: true, access_key: ${MINIO_ACCESS_KEY}, secret_key: ${MINIO_SECRET_KEY} }, wal: { path: /var/tempo/wal } } }
compactor: { compaction: { block_retention: 720h } }   # 168h on dev
```

### 5.4 Prometheus

```yaml
global: { scrape_interval: 15s }
scrape_configs:
  - { job_name: backend, metrics_path: /metrics, static_configs: [{ targets: ["backend:<app-port>"] }] }
  - { job_name: backend-otel, metrics_path: /metrics, static_configs: [{ targets: ["backend:9464"] }] }
  - { job_name: node, static_configs: [{ targets: ["node-exporter:9100"] }] }
  - { job_name: cadvisor, static_configs: [{ targets: ["cadvisor:8080"] }] }
```

### 5.5 Vector (MUST pass `--config`, else it runs the demo config)

```toml
[sources.docker_logs]
type = "docker_logs"
[transforms.add_labels]
type = "remap"
inputs = ["docker_logs"]
source = '''
.service = .label."com.project.service" || "unknown"
.env = .label."com.project.env" || "production"
parsed, err = parse_json(.message)
if err == null { del(parsed.password); del(parsed.token); del(parsed.authorization); del(parsed.accessToken); del(parsed.refreshToken); .message = encode_json(parsed) }
'''
[sinks.loki]
type = "loki"
inputs = ["add_labels"]
endpoint = "http://loki:3100"
[sinks.loki.labels]
service = "{{ service }}"
env = "{{ env }}"
[sinks.loki.encoding]
codec = "text"
```
Compose: `command: ["--config", "/etc/vector/vector.toml"]`, mount the docker socket,
and set `labels: { com.project.service: <name>, com.project.env: <env> }` on every service.
**Low-cardinality labels only** (`service`, `env`); `traceId`/`userId` stay in the log
line (queried via `| json`), never labels.

### 5.6 Grafana provisioning

- **Datasources** with stable `uid`s: `loki`, `tempo`, `prometheus`. Loki derived
  field `traceId` -> Tempo (`uid: tempo`).
- **Dashboards**: a file provider (`dashboards.yaml`) -> `/var/lib/grafana/dashboards`
  with JSON for: Backend RED (rate/5xx/error%/p50-95-99/by route), Containers & Host
  USE (cAdvisor + node-exporter), Logs overview (Loki, `service` var). Import exhaustive
  community ones (Node Exporter Full `1860`, cAdvisor) via the UI by id.
- **Alert rules** (`alerting/rules.yaml`): backend down (`up{job="backend"}<1`), 5xx
  rate >5%, p95 >1s, error-log volume >10/min. Each rule: refId `A` = query, refId `C`
  = threshold expression named as the `condition`.
- **Telegram** (`alerting/contactpoints.yaml` + `policies.yaml`): contact point + root
  policy routing all alerts to Telegram. Token + chat id from env, **both quoted**:

```yaml
# contactpoints.yaml — Grafana interpolates ${VAR} as raw text BEFORE YAML parse,
# so quote both; the bot token's ':' otherwise breaks YAML and mis-reads chatid as a number.
contactPoints:
  - orgId: 1
    name: telegram
    receivers:
      - { uid: telegram-default, type: telegram, settings: { bottoken: "${TELEGRAM_BOT_TOKEN}", chatid: "${TELEGRAM_CHAT_ID}" } }
```
Get a bot token from `@BotFather`; get the chat id from
`https://api.telegram.org/bot<TOKEN>/getUpdates` after messaging the bot. A provisioned
alert rule is **not** deleted by removing its file — use a `deleteRules:` entry or the API.

---

## 6. Deployment (build-tool agnostic)

### Common rules
- **Deploy flow**: commit -> push `main` -> on VPS `git pull` -> `docker compose up -d --build`.
- **No docker for local dev** (native Postgres only; observability stack off).
- **Secrets**: runtime secrets in a gitignored `.env` (compose interpolation +
  `env_file`); build-time secrets (Sentry token) via **BuildKit secret mount**, never a
  build `ARG` (ARGs bake into image history) and never committed.
- **Source maps are mandatory every deploy, BE + FE, and never served to the client.**
  Set `SENTRY_RELEASE=$(git rev-parse --short HEAD)` at deploy; it must match
  `Sentry.init({ release })` and the uploaded maps.
- One-shot `createbuckets` (minio/mc) makes the Loki + Tempo buckets before they start;
  Loki/Tempo start with `-config.expand-env=true`.
- Each infra container declares a `healthcheck`; gate order with
  `depends_on: { condition: service_healthy }`.

### Source map upload

Frontend (`@sentry/vite-plugin`, `build.sourcemap: true`):
```ts
sentryVitePlugin({
  org, project, url: "https://us.sentry.io", authToken: process.env.SENTRY_AUTH_TOKEN,
  release: process.env.SENTRY_RELEASE ? { name: process.env.SENTRY_RELEASE } : undefined,
  sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] }, // delete after upload
})
```
Backend (`@sentry/cli`, tsconfig `sourceMap: true`):
```sh
sentry-cli sourcemaps inject <dist> && sentry-cli sourcemaps upload --org <o> --project <p> --release "$SENTRY_RELEASE" <dist>
```
Both Dockerfiles also run `find <dist> -name '*.map' -delete` as a safety net so nginx
never serves a `.map`. Auth token = Sentry **Organization Token**, scope `org:ci`.

### Image build (same shape for any package manager)

Backend image (multi-stage):
1. Copy manifest(s) + lockfile, `install` deps, `COPY . .`, `build` (compile to `dist`,
   tsconfig `sourceMap: true`).
2. Inject + upload source maps, then strip them:
   ```dockerfile
   ARG SENTRY_RELEASE=dev
   RUN --mount=type=secret,id=sentry_auth_token \
       if [ -s /run/secrets/sentry_auth_token ]; then \
         export SENTRY_AUTH_TOKEN=$(cat /run/secrets/sentry_auth_token); \
         npx @sentry/cli sourcemaps inject <dist> ; \
         npx @sentry/cli sourcemaps upload --org <o> --project <p> --release "$SENTRY_RELEASE" <dist> ; \
       fi; \
       find <dist> -name '*.map' -delete
   ```
3. Runtime stage installs prod deps only and copies `dist`.

Frontend image: `install`, `build` (bundler emits source maps; the Sentry bundler
plugin uploads + deletes them), then `find <dist> -name '*.map' -delete` as a safety
net, then copy `dist` into the nginx image.

BuildKit secret wiring in compose (so the token is never an image layer):
```yaml
services:
  backend:
    build:
      args: { SENTRY_RELEASE: ${SENTRY_RELEASE:-dev} }
      secrets: [sentry_auth_token]
secrets:
  sentry_auth_token: { environment: SENTRY_AUTH_TOKEN }
```

**Monorepo caveat (any tool)**: if the app imports internal workspace packages
(e.g. a `shared` lib), **build those inside the image before building the app** — both
the backend AND the frontend need the shared package's compiled output/types, or you
get "Cannot find module '<shared>'" + cascade type errors. If a build/CLI step runs
with its cwd set to a sub-package (some workspace runners do), pass paths relative to
that cwd, not from the repo root.

---

## 7. Gotchas (real failures hit building this — keep them here)

1. **Loki `${MINIO_*}` in a comment** -> `failed parsing config: missing closing brace`.
   `-config.expand-env` runs envsubst over the whole file incl. comments; never write a
   `${...}` token in a Loki/Tempo comment.
2. **Loki inline s3 DSN** (`s3: http://k:s@minio:9000/bucket`) -> compactor
   `MissingEndpoint`. Use explicit `endpoint`/`bucketnames`/`region` fields.
3. **Vector with no `--config`** -> runs the image's built-in demo_logs config; your
   container logs never reach Loki. Always pass `command: ["--config", "..."]`.
4. **Sentry captured `error.cause`** -> drops your throw-site frame; everything groups
   under the library's stack. Capture `opts.error` (the TRPCError); Sentry follows `.cause`.
5. **No first-party frame** (library throws across async) -> source maps have nothing to
   map. Wrap + re-throw a domain error so your frame is on the stack.
6. **Grafana `${VAR}` is raw-text interpolated before YAML parse** -> quote every
   interpolated value; an unquoted bot token (`:`) breaks YAML and mis-types `chatid`.
7. **A workspace runner that `exec`s with cwd set to a sub-package** -> pass the
   source-map path relative to that cwd, not from the repo root (else "No such file").
8. **Image didn't build internal shared packages before the app** -> "Cannot find
   module '<shared>'" + cascade type errors (hits the frontend too, not just backend).
9. **Provisioned alert rules don't delete on file removal** -> use `deleteRules:`.
10. **Build `ARG` for the Sentry token** bakes it into image history -> use a BuildKit
    secret mount instead.
11. **`COOKIE_SECURE=true` over HTTP dev VPS** -> login silently fails (no cookie). Set
    `false` for HTTP tiers.
12. **DB has no tables on a fresh VPS** -> run migrations after first deploy; "relation
    does not exist" 500s are a missing-migration symptom, not an app bug.

---

## 8. Verification checklist (definition of done)

Run after deploy; all must pass:
- [ ] `GET /health` -> `200 {"status":"ok"}`; `GET /health/ready` -> `200` (pg+redis+minio).
- [ ] Every container `Up`/healthy; `createbuckets` exited 0.
- [ ] Loki has `service` label values (Vector shipping): `/loki/api/v1/label/service/values`.
- [ ] A backend log line in Loki is JSON with `traceId` and redacted `cookie`.
- [ ] Tempo has the service: `/api/search/tag/service.name/values` -> includes `backend`.
- [ ] Prometheus targets `up` (backend, backend-otel, node, cadvisor).
- [ ] Generate one request, then fetch its trace by `traceId` in Tempo (FE root span present
      if FE OTLP wired).
- [ ] Grafana: 3 dashboards loaded, 4 alert rules `health=ok`.
- [ ] **No `.map` served**: `find /usr/share/nginx/html -name '*.map'` -> 0; a `.map` URL
      returns the SPA fallback (text/html), not a source map.
- [ ] Sentry: trigger an app-code error; the issue's top frame maps to your `.ts` with the
      correct `release`; `cause` chain present.
- [ ] Fire one test alert -> received in Telegram.

---

## 9. Debug workflow (incident with a traceId)

1. **Sentry**: find the issue -> source-mapped stack + `cause`; note `release`, `environment`.
2. **Loki**: `{service="backend"} | json | traceId="<id>"` -> request context (incl. the
   `internal error` line with `cause`). NOTE: `traceId` is a line filter, never a label.
3. **Tempo**: click the log's `traceId` -> span waterfall; find the slow/errored span.
4. Fix; commit `Fixes <ISSUE-ID>` to auto-close in Sentry.

---

## 10. Boundaries — do NOT

- No docker for local dev (native Postgres; stack off; OTel uses console exporter).
- Never expose `/metrics` through public nginx (leaks traffic shape + endpoint inventory).
- Never serve source maps to the client; upload to Sentry then delete from the bundle.
- Never commit secrets; build-time secrets via BuildKit, runtime via gitignored `.env`.
- Never push a secret through a build `ARG`.
- `traceId`/`userId` are log-line fields, never Loki/Tempo labels (cardinality blowup).
- Don't add a second OTel provider (Sentry `skipOpenTelemetrySetup: true`).
- Don't log health probes; don't log secrets (redact at logger + Vector).
- Don't substitute stack components (section 1 is fixed).

---

## 11. Resources (rough, single small VPS)

Loki ~128MB, Tempo ~256MB, Prometheus ~512MB, Grafana ~512MB, Vector <150MB —
~1.5 core / ~1.7GB total. Sentry free tier 5k events/mo (guard with `sampleRate` +
`tracesSampleRate` < 1). Minio reused.

---

## 12. Deferred (add when needed)

Alertmanager (advanced routing/on-call), OTel Collector (central OTLP pipeline),
Pyroscope (profiling), Grafana Faro (FE RUM), Uptime Kuma / synthetic checks.
