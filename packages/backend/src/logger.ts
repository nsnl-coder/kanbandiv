import { pino } from "pino";
import { trace } from "@opentelemetry/api";
import { env } from "./config/env.config.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  // pino-pretty only locally; any VPS emits raw JSON for Vector -> Loki.
  transport: env.isLocal ? { target: "pino-pretty" } : undefined,
  base: { service: "backend", env: env.VPS_ENV },
  // PII scrubbing enforced at the logger, not by policy. Pino wildcards are
  // shallow (depth 2); deeply nested secrets are caught by the Vector remap.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.creditCard",
      "*.cardNumber",
    ],
    censor: "[REDACTED]",
  },
  // Inject the active OTel span ids into every line so logs join traces.
  mixin() {
    const span = trace.getActiveSpan()?.spanContext();
    return span ? { traceId: span.traceId, spanId: span.spanId } : {};
  },
});
