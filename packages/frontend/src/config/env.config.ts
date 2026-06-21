const env = import.meta.env;

export const config = {
  apiUrl: (env.VITE_API_URL as string | undefined) ?? "/trpc",
  // SSE/OpenAPI base. tRPC lives at `<base>/trpc`; the REST/SSE routes live at
  // `<base>/api`. Derive by swapping the trailing `/trpc` so no new env var is
  // needed (local: backend-origin/api; prod same-origin: /api).
  apiBaseUrl:
    ((env.VITE_API_URL as string | undefined) ?? "/trpc").replace(
      /\/trpc$/,
      "",
    ) + "/api",
  // Deployment tier. Same VPS_ENV concept as the backend; Vite requires the
  // VITE_ prefix to expose it to the bundle.
  appEnv: (env.VITE_VPS_ENV as string | undefined) ?? "local",
  isDev: env.DEV,
  // Public OTLP path (nginx -> Tempo). Empty -> no trace export (local).
  otelEndpoint: (env.VITE_OTEL_ENDPOINT as string | undefined) ?? "",
  // Sentry DSN. Empty -> Sentry disabled (local).
  sentryDsn: (env.VITE_SENTRY_DSN as string | undefined) ?? "",
} as const;

export type AppConfig = typeof config;
