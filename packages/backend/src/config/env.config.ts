import "dotenv/config";
import { z } from "zod";

// Single deployment-tier knob (root .env.{local,dev,prod}). Drives log format,
// docs, Sentry env, and trace sampling. NODE_ENV is left to libraries only.
const VPS_ENVS = ["local", "dev", "prod"] as const;
type VpsEnv = (typeof VPS_ENVS)[number];
const vpsEnv = (process.env.VPS_ENV ?? "local") as VpsEnv;
if (!VPS_ENVS.includes(vpsEnv)) {
  throw new Error(`Invalid VPS_ENV: ${process.env.VPS_ENV} (expected local|dev|prod)`);
}
const isLocal = vpsEnv === "local";

// Convenience defaults only exist locally; any deployed tier must set real URLs.
const url = (def: string) =>
  isLocal ? z.string().url().default(def) : z.string().url();

const schema = z.object({
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: url("postgres://postgres:postgres@localhost:5432/trelloclone"),

  // Secrets are ALWAYS required (no env-gated default) so a misconfigured
  // tier can never fall back to a committed signing key. Set them in
  // .env.local for dev; tests inject them via vitest.config.ts.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  // Single source of truth for access-token lifetime. The cookie maxAge is
  // derived from this (see ACCESS_TTL_MS below) so the two can never drift.
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_ISS: z.string().default("trelloclone"),
  JWT_AUD: z.string().default("trelloclone-web"),
  REFRESH_TTL_MS: z.coerce
    .number()
    .default(7 * 24 * 60 * 60 * 1000),

  // Allowed browser origins for credentialed CORS (frontend on a different
  // subdomain than the API). Comma-separated; empty -> no CORS (same-origin).
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  // Cookie Secure flag: default true (fail safe); set false only for local HTTP dev.
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  BCRYPT_COST: z.coerce.number().min(12).default(12),

  // Optional bootstrap super admin, seeded on startup. Both must be set to seed;
  // empty -> seeding skipped. Idempotent (see scripts/seedSuperAdmin.ts).
  SUPER_ADMIN_EMAIL: z.string().email().or(z.literal("")).default(""),
  SUPER_ADMIN_PASSWORD: z.string().min(8).or(z.literal("")).default(""),

  MAIL_HOST: z.string().default("sandbox.smtp.mailtrap.io"),
  MAIL_PORT: z.coerce.number().default(2525),
  MAIL_USER: z.string().default(""),
  MAIL_PASS: z.string().default(""),
  MAIL_FROM: z.string().default("no-reply@trelloclone.dev"),

  // --- Observability (all optional; absence = local/off behaviour) ---
  // Override Pino level; empty -> derived from VPS_ENV (debug local/dev, info prod).
  LOG_LEVEL: z.string().default(""),
  // OTLP traces endpoint (Tempo). Empty -> ConsoleSpanExporter, no Tempo (local).
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(""),
  // Sentry DSN. Empty -> Sentry disabled (local).
  SENTRY_DSN: z.string().default(""),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().default(0.1),
  // Release id (git sha), set at deploy; ties errors to uploaded source maps.
  SENTRY_RELEASE: z.string().default(""),
  // Readiness deps. Only checked in /health/ready when the URL is set.
  REDIS_URL: z.string().default(""),
  MINIO_ENDPOINT: z.string().default(""),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MINIO_ATTACHMENTS_BUCKET: z.string().default("attachments"),
  ATTACHMENT_MAX_BYTES: z.coerce.number().default(10485760),

  // --- Backup (Google Drive OAuth + job pipeline) ---
  // OAuth client (Google Cloud console). Empty -> Drive features disabled.
  GDRIVE_CLIENT_ID: z.string().default(""),
  GDRIVE_CLIENT_SECRET: z.string().default(""),
  // Public callback URL the proxy routes to /api/admin/backup/gdrive/callback.
  GDRIVE_REDIRECT_URI: z.string().default(""),
  // Frontend base URL the OAuth callback redirects back to after connecting.
  APP_BASE_URL: z.string().default(""),
  // Optional default Drive folder for uploads (overridable per settings row).
  GDRIVE_FOLDER_ID: z.string().default(""),
  // Working dir for dump/tar staging. Defaults to the OS temp dir.
  BACKUP_WORK_DIR: z.string().default(""),
  // Symmetric passphrase for optional at-rest backup encryption (gpg).
  BACKUP_ENCRYPTION_PASSPHRASE: z.string().default(""),
  // Encrypts the Drive refresh token at rest. Falls back to JWT_REFRESH_SECRET.
  BACKUP_TOKEN_SECRET: z.string().default(""),
  // MinIO bucket(s) to mirror, comma-separated. Empty -> mirror skipped.
  MINIO_BACKUP_BUCKETS: z.string().default(""),
  MINIO_ACCESS_KEY: z.string().default(""),
  MINIO_SECRET_KEY: z.string().default(""),

  // --- Admin SSO (forward-auth gate for Grafana/MinIO behind the proxy) ---
  // HMAC secret for SSO transfer/session tokens. Empty -> falls back to JWT_ACCESS_SECRET.
  SSO_SECRET: z.string().default(""),
  // Hosts the admin SSO gate may mint tokens for (comma-separated allowlist).
  SSO_ALLOWED_HOSTS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  // App origin used to bounce unauthenticated admins to the login page.
  SSO_APP_ORIGIN: z.string().default(""),
  // SSO session cookie lifetime (bounds role-revocation lag).
  SSO_SESSION_TTL: z.string().default("1h"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

/** Parse a jsonwebtoken-style duration ("15m", "1h", "7d", "30s", or bare ms). */
function parseDurationMs(s: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(s.trim());
  if (!m) throw new Error(`Invalid JWT_ACCESS_TTL duration: ${s}`);
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(m[1]) * mult[(m[2] ?? "ms") as keyof typeof mult];
}

export const env = {
  ...parsed.data,
  // Access cookie maxAge, derived from JWT_ACCESS_TTL (no separate env var).
  ACCESS_TTL_MS: parseDurationMs(parsed.data.JWT_ACCESS_TTL),
  // SSO tokens reuse the access secret unless an explicit one is set.
  SSO_SECRET: parsed.data.SSO_SECRET || parsed.data.JWT_ACCESS_SECRET,
  SSO_SESSION_TTL_MS: parseDurationMs(parsed.data.SSO_SESSION_TTL),
  // Everything below is derived from the single VPS_ENV knob.
  VPS_ENV: vpsEnv,
  isLocal,
  LOG_LEVEL: parsed.data.LOG_LEVEL || (vpsEnv === "prod" ? "info" : "debug"),
  SENTRY_ENV: vpsEnv,
  OTEL_SAMPLE_RATIO: vpsEnv === "prod" ? 0.1 : 1,
};
