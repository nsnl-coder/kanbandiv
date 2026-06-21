// Load OTel first so http/express/pg are instrumented before they are imported.
import "./tracing.js";
import "./sentry.js";

import express, { type RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createOpenApiExpressMiddleware } from "trpc-to-openapi";
import { env } from "./config/env.config.js";
import { logger } from "./logger.js";
import { Sentry, sentryEnabled } from "./sentry.js";
import { metricsMiddleware, metricsHandler } from "./metrics.js";
import { healthHttpRouter } from "./features/health/health.http.js";
import { clientLogRouter } from "./features/health/client-log.http.js";
import { backupHttpRouter } from "./features/backup/backup.http.js";
import { ssoHttpRouter } from "./features/sso/sso.http.js";
import { attachmentHttpRouter } from "./features/attachment/attachment.http.js";
import { storage } from "./features/attachment/attachment.storage.js";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";
import { openApiDocument } from "./openapi.js";
import { appDb } from "./db/index.js";
import { startScheduler } from "./features/backup/backup.scheduler.js";
import { startReminderScheduler } from "./features/card/card.reminder.scheduler.js";
import { loadMaintenanceFlag } from "./features/backup/backup.service.js";
import { seedSuperAdmin } from "./scripts/seedSuperAdmin.js";

const app = express();
// Docs are served only on local; never on a deployed tier (auth attack surface).
const showDocs = env.isLocal;

// tRPC catches handler throws and serializes them into the 500 response, so
// pino-http only sees a generic "status 500". Surface the real error (e.g. an
// SMTP failure) to Loki + Sentry, tagged with the active traceId, so it is
// queryable. Only server faults are reported; expected 4xx stay quiet.
function reportTrpcError(opts: {
  error: { code: string; message: string; cause?: unknown };
  path?: string;
  type: string;
}): void {
  if (opts.error.code !== "INTERNAL_SERVER_ERROR") return;
  const cause = opts.error.cause;
  logger.error(
    { err: opts.error, cause, path: opts.path, type: opts.type },
    "trpc internal error",
  );
  // Capture the TRPCError itself (keeps our throw site / source-mapped frame);
  // Sentry follows error.cause to also show the underlying error in the chain.
  if (sentryEnabled) Sentry.captureException(opts.error);
}

// Trust the single reverse-proxy hop (nginx) so req.ip is the real client IP
// for rate limiting, not the proxy address.
app.set("trust proxy", 1);

// Metrics timing wraps every request; pino-http logs each one (health/metrics
// probes excluded so they don't flood Loki).
app.use(metricsMiddleware);
app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) =>
        req.url === "/metrics" || (req.url?.startsWith("/health") ?? false),
    },
  }),
);

app.use(helmet());

// Credentialed CORS for the frontend when it lives on a different subdomain than
// the API. Only the configured origins are reflected, so a forged cross-site
// request from any other origin still fails the preflight (the x-requested-with
// CSRF marker can't be set without an allowed CORS preflight). Empty list ->
// same-origin deploy, no CORS.
if (env.CORS_ORIGINS.length) {
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
}

// Liveness + readiness (no CSRF/JSON needed); /metrics for Prometheus over the
// internal network only - nginx must not expose it publicly.
app.use(healthHttpRouter);
app.get("/metrics", metricsHandler);

// CSRF defense-in-depth on top of SameSite=strict cookies: state-changing
// requests must carry a custom header. Browsers cannot set custom headers on
// cross-site requests without a CORS preflight, which fails here (no CORS), so
// a forged cross-site POST is rejected before it reaches an authed handler.
const csrfGuard: RequestHandler = (req, res, next) => {
  const safe = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
  if (!safe && req.get("x-requested-with") !== "XMLHttpRequest") {
    res.status(403).json({ error: "CSRF check failed" });
    return;
  }
  next();
};

// Browser behaviour logs -> Loki (csrf + auth + rate-limit + allowlist inside).
app.use("/api", clientLogRouter);

// Google Drive OAuth redirect lands here (plain GET; re-auths from the cookie).
// Mounted before the tRPC/REST handlers so it owns this exact path.
app.use("/api", backupHttpRouter);

// Admin SSO forward-auth gate (Grafana/MinIO on sibling subdomains). Plain GET
// redirects + an auth_request verify endpoint; mounted before tRPC/REST.
app.use("/api", ssoHttpRouter);

// Multipart attachment upload/download. Mounted before the /api JSON body parser
// and tRPC so these multipart routes are never touched by express.json().
app.use("/api", attachmentHttpRouter);

// Native tRPC endpoint (used by the typed frontend client).
app.use(
  "/trpc",
  csrfGuard,
  createExpressMiddleware({ router: appRouter, createContext, onError: reportTrpcError }),
);

// REST layer + OpenAPI/Swagger docs generated from the same router.
app.use(
  "/api",
  express.json(),
  createOpenApiExpressMiddleware({ router: appRouter, createContext: createContext as never, onError: reportTrpcError as never }),
);
// Docs expose the full auth attack surface; never serve them on a deployed tier.
if (showDocs) {
  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
}

// Capture unhandled route errors in Sentry (carries the OTel traceId for cross-ref).
if (sentryEnabled) Sentry.setupExpressErrorHandler(app);

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, vpsEnv: env.VPS_ENV }, "backend listening");
  if (showDocs) logger.info(`API docs at http://localhost:${env.PORT}/docs`);
  // Bootstrap the super admin from env (idempotent; no-op without creds).
  seedSuperAdmin(appDb).catch((err) =>
    logger.error({ err }, "failed to seed super admin"),
  );
  // Hydrate the maintenance flag and register the backup schedule from the DB.
  loadMaintenanceFlag(appDb).catch((err) =>
    logger.error({ err }, "failed to load maintenance flag"),
  );
  startScheduler(appDb).catch((err) =>
    logger.error({ err }, "failed to start backup scheduler"),
  );
  startReminderScheduler(appDb);
  // Best-effort: create the attachments bucket if storage is configured.
  storage.ensureBucket().catch((err) =>
    logger.error({ err }, "ensure attachments bucket failed"),
  );
});
