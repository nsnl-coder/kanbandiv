import express, { type RequestHandler } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createOpenApiExpressMiddleware } from "trpc-to-openapi";
import { env } from "./config/env.config.js";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";
import { openApiDocument } from "./openapi.js";

const app = express();
const isProd = env.NODE_ENV === "production";

// Trust the single reverse-proxy hop (nginx) so req.ip is the real client IP
// for rate limiting, not the proxy address.
app.set("trust proxy", 1);
app.use(helmet());

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
// Docs expose the full auth attack surface; never serve them in production.
if (!isProd) {
  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
}

app.listen(env.PORT, () => {
  console.log(`Backend listening on http://localhost:${env.PORT}`);
  if (!isProd) console.log(`API docs at http://localhost:${env.PORT}/docs`);
});
