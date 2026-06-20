import * as Sentry from "@sentry/react";
import { config } from "./config/env.config";

// Empty DSN (local) -> Sentry stays disabled.
export const sentryEnabled = !!config.sentryDsn;

if (sentryEnabled) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.appEnv,
    integrations: [Sentry.browserTracingIntegration()],
    // < 1 so one error storm doesn't exhaust the free-tier monthly quota.
    tracesSampleRate: 0.1,
  });
}

export { Sentry };
