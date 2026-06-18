import cors from "cors";
import express from "express";
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
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

// Native tRPC endpoint (used by the typed frontend client).
app.use(
  "/trpc",
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
