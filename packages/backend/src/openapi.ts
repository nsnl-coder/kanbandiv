import { generateOpenApiDocument } from "trpc-to-openapi";
import { env } from "./config/env.config.js";
import { appRouter } from "./trpc/router.js";

export const openApiDocument = generateOpenApiDocument(appRouter, {
  title: "Trelloclone API",
  description: "Auth API (email + password, OTP verification & password reset).",
  version: "1.0.0",
  baseUrl: `http://localhost:${env.PORT}/api`,
  docsUrl: "/docs",
  tags: ["auth", "admin", "backup"],
  securitySchemes: {
    Authorization: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
  },
});
