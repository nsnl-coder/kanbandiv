import { z } from "zod";

// Allowlist for the public /api/client-log endpoint. Anything not listed here is
// stripped server-side so the endpoint cannot be used for log injection. Keep
// fields small + bounded; payload size is also capped at the express layer.
export const clientLogSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  message: z.string().min(1).max(2000),
  // OTel trace id captured in the browser, ties the FE log to its BE trace.
  traceId: z.string().max(64).optional(),
  // Free-form but bounded context (route, component, action, etc.).
  context: z.record(z.string(), z.unknown()).optional(),
  url: z.string().max(2000).optional(),
});

export type ClientLog = z.infer<typeof clientLogSchema>;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
