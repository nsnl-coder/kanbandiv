const env = import.meta.env;

// Deployment tier = the Vite mode (no env var needed):
//   `vite` (dev server)      -> local (Vite's default "development" mode;
//                               "local" can't be a mode name in Vite 6)
//   `vite build --mode dev`  -> dev
//   `vite build --mode prod` -> prod
const appEnv: "local" | "dev" | "prod" =
  env.MODE === "prod"
    ? "prod"
    : env.MODE === "dev"
      ? "dev"
      : "local"; // "development" (Vite default) and anything else -> local
const isLocal = appEnv === "local";

// Per-tier API origin: the only value that differs per tier (dev is
// cross-origin; local/prod are same-origin). Literal refs so Vite can inline.
const apiUrl =
  appEnv === "prod"
    ? (env.VITE_API_URL_PROD as string | undefined) ?? "/trpc"
    : appEnv === "dev"
      ? (env.VITE_API_URL_DEV as string | undefined) ?? "/trpc"
      : (env.VITE_API_URL_LOCAL as string | undefined) ?? "/trpc";

// Observability/ops consoles on sibling subdomains (admin SSO-gated). null
// locally (no such hosts); per-tier domains otherwise. Used by the admin nav.
function consoleHosts(prefix: string) {
  return {
    grafana: `https://${prefix}grafana.trello-clone.shop`,
    minio: `https://${prefix}minio.trello-clone.shop`,
    redis: `https://${prefix}redis.trello-clone.shop`,
    prometheus: `https://${prefix}prometheus.trello-clone.shop`,
    cadvisor: `https://${prefix}cadvisor.trello-clone.shop`,
    pgadmin: `https://${prefix}pgadmin.trello-clone.shop`,
    portainer: `https://${prefix}portainer.trello-clone.shop`,
  };
}
const opsConsoles =
  appEnv === "prod" ? consoleHosts("") : appEnv === "dev" ? consoleHosts("dev-") : null;

export const config = {
  apiUrl,
  // External admin consoles (Grafana, RedisInsight); null on local.
  opsConsoles,
  // SSE/OpenAPI base. tRPC lives at `<base>/trpc`; the REST/SSE routes live at
  // `<base>/api`. Derive by swapping the trailing `/trpc` so no new env var is
  // needed (local: backend-origin/api; prod same-origin: /api).
  apiBaseUrl: apiUrl.replace(/\/trpc$/, "") + "/api",
  appEnv,
  isDev: env.DEV,
  // Public OTLP path (nginx -> Tempo). Empty locally -> no trace export.
  otelEndpoint: isLocal ? "" : "/otlp",
  // Public Sentry DSN (same on every tier). Sentry stays disabled locally via
  // the appEnv check in sentry.ts.
  sentryDsn:
    "https://e05fe1792d0a2a4073c48522cfdb47f7@o4511595557486592.ingest.us.sentry.io/4511595562336256",
} as const;

export type AppConfig = typeof config;
