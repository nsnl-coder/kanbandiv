const env = import.meta.env;

export const config = {
  apiUrl: (env.VITE_API_URL as string | undefined) ?? "/trpc",
  appEnv: (env.VITE_APP_ENV as string | undefined) ?? "local",
  isDev: env.DEV,
} as const;

export type AppConfig = typeof config;
