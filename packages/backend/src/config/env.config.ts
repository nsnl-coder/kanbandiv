import 'dotenv/config';
import { z } from 'zod';

// Single deployment-tier knob (root .env.{local,dev,prod}). Drives log format,
// docs, Sentry env, trace sampling, and cookie security. NODE_ENV is left to
// libraries only.
const VPS_ENVS = ['local', 'dev', 'prod'] as const;
type VpsEnv = (typeof VPS_ENVS)[number];
const vpsEnv = (process.env.VPS_ENV ?? 'local') as VpsEnv;
if (!VPS_ENVS.includes(vpsEnv)) {
  throw new Error(
    `Invalid VPS_ENV: ${process.env.VPS_ENV} (expected local|dev|prod)`,
  );
}
const isLocal = vpsEnv === 'local';
const tier = vpsEnv.toUpperCase(); // LOCAL | DEV | PROD

// Resolve per-tier inputs from a single .env: KEY_<TIER> wins, else the shared
// plain KEY. So only secrets that differ across tiers need a suffix.
const tiered = (shape: Record<string, unknown>) => {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(shape)) {
    out[key] = process.env[`${key}_${tier}`] ?? process.env[key];
  }
  return out;
};

// --- Code-determined constants ---------------------------------------------
// Identical on every tier, so they live in code (no .env entry). Tune here.
const constants = {
  PORT: 4000,
  // Single source of truth for access-token lifetime. The cookie maxAge is
  // derived from this (see ACCESS_TTL_MS below) so the two can never drift.
  JWT_ACCESS_TTL: '15m',
  JWT_ISS: 'trelloclone',
  JWT_AUD: 'trelloclone-web',
  REFRESH_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  BCRYPT_COST: 12,
  MAIL_PORT: 2525,
  MAIL_FROM: 'admin@trello-clone.shop',
  // MinIO sits behind the proxy (internal HTTP), same bucket/port everywhere.
  MINIO_PORT: 9000,
  MINIO_USE_SSL: false,
  MINIO_ATTACHMENTS_BUCKET: 'attachments',
  ATTACHMENT_MAX_BYTES: 10_485_760,
  // SSO session cookie lifetime (bounds role-revocation lag).
  SSO_SESSION_TTL: '1h',
  SENTRY_TRACES_SAMPLE_RATE: 0.1,
};

// Convenience defaults only exist locally; any deployed tier must set real URLs.
const url = (def: string) =>
  isLocal ? z.string().url().default(def) : z.string().url();

// --- Real environment inputs (secrets + per-deployment values) -------------
// Everything below is a secret or varies by deployment, so it cannot be
// determined in code and must be supplied via the environment.
const schema = z.object({
  DATABASE_URL: url('postgres://postgres:postgres@localhost:5432/trelloclone'),

  // Secrets are ALWAYS required (no env-gated default) so a misconfigured
  // tier can never fall back to a committed signing key. Set them in
  // .env for dev (JWT_*_SECRET_LOCAL); tests inject them via vitest.config.ts.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),

  // Allowed browser origins for credentialed CORS (frontend on a different
  // subdomain than the API). Comma-separated; empty -> no CORS (same-origin).
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Optional bootstrap super admin, seeded on startup. Both must be set to seed;
  // empty -> seeding skipped. Idempotent (see scripts/seedSuperAdmin.ts).
  SUPER_ADMIN_EMAIL: z.string().email().or(z.literal('')).default(''),
  SUPER_ADMIN_PASSWORD: z.string().min(8).or(z.literal('')).default(''),

  // Mail transport varies by tier: shared sandbox for local+dev (plain KEY),
  // real provider for prod (KEY_PROD). Resolved by tiered() above.
  MAIL_HOST: z.string().default('sandbox.smtp.mailtrap.io'),
  MAIL_USER: z.string().default(''),
  MAIL_PASS: z.string().default(''),

  // --- Observability (all optional; absence = local/off behaviour) ---
  // Override Pino level; empty -> derived from VPS_ENV (debug local/dev, info prod).
  LOG_LEVEL: z.string().default(''),
  // OTLP traces endpoint (Tempo). Empty -> ConsoleSpanExporter, no Tempo (local).
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(''),
  // Sentry DSN. Empty -> Sentry disabled (local).
  SENTRY_DSN: z.string().default(''),
  // Release id (git sha), set at deploy; ties errors to uploaded source maps.
  SENTRY_RELEASE: z.string().default(''),
  // Readiness deps. Only checked in /health/ready when the URL is set.
  REDIS_URL: z.string().default(''),
  MINIO_ENDPOINT: z.string().default(''),
  MINIO_ACCESS_KEY: z.string().default(''),
  MINIO_SECRET_KEY: z.string().default(''),

  // --- Backup (Google Drive OAuth + job pipeline) ---
  // OAuth client (Google Cloud console). Empty -> Drive features disabled.
  GDRIVE_CLIENT_ID: z.string().default(''),
  GDRIVE_CLIENT_SECRET: z.string().default(''),
  // Public callback URL the proxy routes to /api/admin/backup/gdrive/callback.
  // Must match the URI registered in Google console, so it stays an env input.
  GDRIVE_REDIRECT_URI: z.string().default(''),
  // Frontend base URL the OAuth callback redirects back to after connecting.
  APP_BASE_URL: z.string().default(''),
  // Optional default Drive folder for uploads (overridable per settings row).
  GDRIVE_FOLDER_ID: z.string().default(''),
  // Working dir for dump/tar staging. Defaults to the OS temp dir.
  BACKUP_WORK_DIR: z.string().default(''),
  // Symmetric passphrase for optional at-rest backup encryption (gpg).
  BACKUP_ENCRYPTION_PASSPHRASE: z.string().default(''),
  // Encrypts the Drive refresh token at rest. Falls back to JWT_REFRESH_SECRET.
  BACKUP_TOKEN_SECRET: z.string().default(''),
  // MinIO bucket(s) to mirror, comma-separated. Empty -> mirror skipped.
  MINIO_BACKUP_BUCKETS: z.string().default(''),

  // --- Admin SSO (forward-auth gate for Grafana/MinIO behind the proxy) ---
  // HMAC secret for SSO transfer/session tokens. Empty -> falls back to JWT_ACCESS_SECRET.
  SSO_SECRET: z.string().default(''),
  // Hosts the admin SSO gate may mint tokens for (comma-separated allowlist).
  SSO_ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  // App origin used to bounce unauthenticated admins to the login page.
  SSO_APP_ORIGIN: z.string().default(''),
});

const parsed = schema.safeParse(tiered(schema.shape));
if (!parsed.success) {
  console.error(
    'Invalid environment configuration:',
    parsed.error.flatten().fieldErrors,
  );
  throw new Error('Invalid environment configuration');
}

/** Parse a jsonwebtoken-style duration ("15m", "1h", "7d", "30s", or bare ms). */
function parseDurationMs(s: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(s.trim());
  if (!m) throw new Error(`Invalid duration: ${s}`);
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(m[1]) * mult[(m[2] ?? 'ms') as keyof typeof mult];
}

export const env = {
  ...constants,
  ...parsed.data,
  // Access cookie maxAge, derived from JWT_ACCESS_TTL (no separate env var).
  ACCESS_TTL_MS: parseDurationMs(constants.JWT_ACCESS_TTL),
  SSO_SESSION_TTL_MS: parseDurationMs(constants.SSO_SESSION_TTL),
  // SSO tokens reuse the access secret unless an explicit one is set.
  SSO_SECRET: parsed.data.SSO_SECRET || parsed.data.JWT_ACCESS_SECRET,
  // Everything below is derived from the single VPS_ENV knob.
  VPS_ENV: vpsEnv,
  isLocal,
  // Secure cookies everywhere except local HTTP dev.
  COOKIE_SECURE: !isLocal,
  LOG_LEVEL: parsed.data.LOG_LEVEL || (vpsEnv === 'prod' ? 'info' : 'debug'),
  SENTRY_ENV: vpsEnv,
  OTEL_SAMPLE_RATIO: vpsEnv === 'prod' ? 0.1 : 1,
};
