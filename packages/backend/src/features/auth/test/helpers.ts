import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Kysely, PostgresDialect } from "kysely";
import { DataType, newDb } from "pg-mem";
import { OtpPurpose } from "shared";
import { env } from "../../../config/env.config.js";
import type { Database } from "../../../db/types.js";
import { appRouter } from "../../../trpc/router.js";
import type { Context } from "../../../trpc/context.js";
import { up as up001 } from "../../../migrations/001.auth.js";
import { up as up002 } from "../../../migrations/002.rbac.js";
import type { EmailPort } from "../../email/email.service.js";

export type TestDb = Kysely<Database>;

/** Boot a fresh in-memory Postgres, run migrations, return a Kysely instance. */
export async function newTestDb(): Promise<TestDb> {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  const { Pool } = mem.adapters.createPg();
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool() }),
  });
  await up001(db);
  await up002(db);
  return db;
}

export interface SentEmail {
  type: "verify" | "reset" | "locked";
  to: string;
  code?: string;
}

export interface FakeEmail extends EmailPort {
  sent: SentEmail[];
  lastCodeFor(to: string): string | undefined;
  clear(): void;
}

export function fakeEmail(): FakeEmail {
  const sent: SentEmail[] = [];
  return {
    sent,
    sendVerifyOtp: async (to, code) => {
      sent.push({ type: "verify", to, code });
    },
    sendResetOtp: async (to, code) => {
      sent.push({ type: "reset", to, code });
    },
    sendAccountLocked: async (to) => {
      sent.push({ type: "locked", to });
    },
    lastCodeFor(to) {
      for (let i = sent.length - 1; i >= 0; i--) {
        if (sent[i].to === to && sent[i].code) return sent[i].code;
      }
      return undefined;
    },
    clear() {
      sent.length = 0;
    },
  };
}

export interface CookieCall {
  name: string;
  value?: string;
  options: Record<string, unknown>;
}

export interface ResSpy {
  cookies: CookieCall[];
  cleared: CookieCall[];
}

/** A fake express Response that records cookie/clearCookie calls. */
export function resSpy(): ResSpy & Context["res"] {
  const cookies: CookieCall[] = [];
  const cleared: CookieCall[] = [];
  return {
    cookies,
    cleared,
    cookie(name: string, value: string, options: Record<string, unknown>) {
      cookies.push({ name, value, options });
      return this;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      cleared.push({ name, options });
      return this;
    },
  } as unknown as ResSpy & Context["res"];
}

export function makeContext(opts: {
  db: TestDb;
  email?: EmailPort;
  userId?: string | null;
  refreshCookie?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  res?: Context["res"];
}): Context {
  return {
    db: opts.db,
    email: opts.email ?? fakeEmail(),
    userId: opts.userId ?? null,
    refreshCookie: opts.refreshCookie ?? null,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
    res: opts.res ?? null,
  };
}

export function createCaller(ctx: Context) {
  return appRouter.createCaller(ctx);
}

export interface SeedUserOpts {
  email?: string;
  password?: string;
  isSuperuser?: boolean;
  roleId?: string | null;
  verified?: boolean;
  lockedUntil?: Date | null;
  failedLoginCount?: number;
}

export async function seedUser(db: TestDb, opts: SeedUserOpts = {}) {
  const password = opts.password ?? "Password123";
  const row = await db
    .insertInto("users")
    .values({
      email: opts.email ?? "user@example.com",
      password_hash: await bcrypt.hash(password, env.BCRYPT_COST),
      email_verified: opts.verified ?? true,
      is_superuser: opts.isSuperuser ?? false,
      role_id: opts.roleId ?? null,
      failed_login_count: opts.failedLoginCount ?? 0,
      locked_until: opts.lockedUntil ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { ...row, password };
}

export interface SeedOtpOpts {
  userId: string;
  purpose?: OtpPurpose;
  code?: string;
  expired?: boolean;
  consumed?: boolean;
  attempts?: number;
}

export async function seedOtp(db: TestDb, opts: SeedOtpOpts): Promise<string> {
  const code =
    opts.code ?? (opts.purpose === OtpPurpose.ResetPassword ? "12345678" : "123456");
  const expires = opts.expired
    ? new Date(Date.now() - 60_000)
    : new Date(Date.now() + 10 * 60_000);
  await db
    .insertInto("otp_codes")
    .values({
      user_id: opts.userId,
      code_hash: await bcrypt.hash(code, env.BCRYPT_COST),
      purpose: opts.purpose ?? OtpPurpose.VerifyEmail,
      expires_at: expires,
      consumed_at: opts.consumed ? new Date() : null,
      attempts: opts.attempts ?? 0,
    })
    .execute();
  return code;
}

/** Seed a refresh token row directly; returns the raw token. */
export async function seedRefreshToken(
  db: TestDb,
  opts: { userId: string; familyId?: string; revoked?: boolean; expired?: boolean },
): Promise<string> {
  const raw = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  await db
    .insertInto("refresh_tokens")
    .values({
      user_id: opts.userId,
      token_hash: hash,
      family_id: opts.familyId ?? crypto.randomUUID(),
      parent_id: null,
      expires_at: opts.expired
        ? new Date(Date.now() - 60_000)
        : new Date(Date.now() + env.REFRESH_TTL_MS),
      revoked_at: opts.revoked ? new Date() : null,
    })
    .execute();
  return raw;
}
