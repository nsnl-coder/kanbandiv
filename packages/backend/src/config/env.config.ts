import "dotenv/config";
import { z } from "zod";

const isProd = process.env.NODE_ENV === "production";

const url = (def: string) =>
  isProd ? z.string().url() : z.string().url().default(def);

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: url("postgres://postgres:postgres@localhost:5432/trelloclone"),

  // Secrets are ALWAYS required (no env-gated default) so a misconfigured
  // NODE_ENV can never fall back to a committed signing key. Set them in
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

  // Cookie Secure flag: default true (fail safe); set false only for local HTTP dev.
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  BCRYPT_COST: z.coerce.number().min(12).default(12),

  MAIL_HOST: z.string().default("sandbox.smtp.mailtrap.io"),
  MAIL_PORT: z.coerce.number().default(2525),
  MAIL_USER: z.string().default(""),
  MAIL_PASS: z.string().default(""),
  MAIL_FROM: z.string().default("no-reply@trelloclone.dev"),
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
};
