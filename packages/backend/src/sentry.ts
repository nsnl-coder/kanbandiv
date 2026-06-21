import * as Sentry from "@sentry/node";
import { env } from "./config/env.config.js";

// Disabled on local (any tier) and whenever no DSN is set -> all calls no-op.
export const sentryEnabled = !!env.SENTRY_DSN && !env.isLocal;

if (sentryEnabled) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENV, // = VPS_ENV
    release: env.SENTRY_RELEASE || undefined, // ties errors to uploaded source maps
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // Our NodeSDK (tracing.ts) is the single OTel provider; don't let Sentry
    // install a second one (would double-instrument every request).
    skipOpenTelemetrySetup: true,
  });
}

export { Sentry };
