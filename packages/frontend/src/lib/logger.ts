import { trace } from "@opentelemetry/api";
import type { LogLevel } from "shared";
import { Sentry, sentryEnabled } from "../sentry";

// Current OTel trace id (from the active span), or undefined outside a span.
export function getTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId;
}

// Behaviour logs (non-errors) -> backend -> Loki. Errors must go to Sentry, not
// here. Fire-and-forget; never block the UI on logging.
export function clientLog(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  const traceId = getTraceId();
  if (traceId && sentryEnabled) Sentry.setTag("traceId", traceId);
  void fetch("/api/client-log", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({
      level,
      message,
      traceId,
      url: location.pathname,
      context,
    }),
  }).catch(() => {});
}
