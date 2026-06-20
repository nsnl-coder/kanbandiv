// Load OTel first so http/express/pg are instrumented before they are imported.
import "./tracing.js";
import "./sentry.js";

import express, { type RequestHandler } from "express";
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
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";
import { openApiDocument } from "./openapi.js";

const app = express();
// Docs are served only on local; never on a deployed tier (auth attack surface).
const showDocs = env.isLocal;

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

// Native tRPC endpoint (used by the typed frontend client).
app.use(
  "/trpc",
  csrfGuard,
  createExpressMiddleware({ router: appRouter, createContext }),
);

// REST layer + OpenAPI/Swagger docs generated from the same router.
app.use(
  "/api",
  express.json(),
  createOpenApiExpressMiddleware({ router: appRouter, createContext: createContext as never }),
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
});
