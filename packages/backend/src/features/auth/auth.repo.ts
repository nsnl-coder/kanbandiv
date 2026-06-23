import type { Kysely } from "kysely";
import type { OtpPurpose } from "shared";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

const PUBLIC_USER = ["id", "email", "is_superuser", "role_id", "email_verified", "oauth_provider"] as const;

export function findUserByEmail(db: Db, email: string) {
  return db
    .selectFrom("users")
    .selectAll()
    .where("email", "=", email)
    .executeTakeFirst();
}

// True if the email belongs to a dedicated e2e test account (rate-limit exempt).
export async function isTestEmail(db: Db, email: string): Promise<boolean> {
  const row = await db
    .selectFrom("users")
    .select("is_test")
    .where("email", "=", email.toLowerCase())
    .executeTakeFirst();
  return !!row?.is_test;
}

export function findUserById(db: Db, id: string) {
  return db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export function findPublicUserById(db: Db, id: string) {
  return db
    .selectFrom("users")
    .select(PUBLIC_USER)
    .where("id", "=", id)
    .executeTakeFirst();
}

export function createUser(
  db: Db,
  input: { email: string; passwordHash: string; isTest?: boolean },
) {
  return db
    .insertInto("users")
    .values({
      email: input.email,
      password_hash: input.passwordHash,
      ...(input.isTest ? { is_test: true } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

// --- OAuth (Google sign-in) ---

export function findUserByOauthSub(db: Db, provider: string, sub: string) {
  return db
    .selectFrom("users")
    .selectAll()
    .where("oauth_provider", "=", provider)
    .where("oauth_sub", "=", sub)
    .executeTakeFirst();
}

export function linkOauth(db: Db, userId: string, provider: string, sub: string) {
  return db
    .updateTable("users")
    .set({ oauth_provider: provider, oauth_sub: sub, updated_at: new Date() })
    .where("id", "=", userId)
    .execute();
}

export function createOauthUser(
  db: Db,
  input: { email: string; passwordHash: string; provider: string; sub: string },
) {
  return db
    .insertInto("users")
    .values({
      email: input.email,
      password_hash: input.passwordHash,
      email_verified: true,
      oauth_provider: input.provider,
      oauth_sub: input.sub,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function setEmailVerified(db: Db, userId: string) {
  return db
    .updateTable("users")
    .set({ email_verified: true, updated_at: new Date() })
    .where("id", "=", userId)
    .execute();
}

export function updatePassword(db: Db, userId: string, passwordHash: string) {
  return db
    .updateTable("users")
    .set({ password_hash: passwordHash, updated_at: new Date() })
    .where("id", "=", userId)
    .execute();
}

export function setFailedLogin(
  db: Db,
  userId: string,
  count: number,
  lockedUntil: Date | null,
) {
  return db
    .updateTable("users")
    .set({ failed_login_count: count, locked_until: lockedUntil })
    .where("id", "=", userId)
    .execute();
}

export function resetFailedLogin(db: Db, userId: string) {
  return db
    .updateTable("users")
    .set({ failed_login_count: 0, locked_until: null })
    .where("id", "=", userId)
    .execute();
}

// --- OTP ---

export function insertOtp(
  db: Db,
  input: {
    userId: string;
    codeHash: string;
    purpose: OtpPurpose;
    expiresAt: Date;
  },
) {
  return db
    .insertInto("otp_codes")
    .values({
      user_id: input.userId,
      code_hash: input.codeHash,
      purpose: input.purpose,
      expires_at: input.expiresAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function latestActiveOtp(db: Db, userId: string, purpose: OtpPurpose) {
  return db
    .selectFrom("otp_codes")
    .selectAll()
    .where("user_id", "=", userId)
    .where("purpose", "=", purpose)
    .where("consumed_at", "is", null)
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
}

export async function countOtpSince(
  db: Db,
  userId: string,
  purpose: OtpPurpose,
  since: Date,
): Promise<number> {
  const row = await db
    .selectFrom("otp_codes")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("user_id", "=", userId)
    .where("purpose", "=", purpose)
    .where("created_at", ">=", since)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export function incOtpAttempts(db: Db, id: string) {
  return db
    .updateTable("otp_codes")
    .set((eb) => ({ attempts: eb("attempts", "+", 1) }))
    .where("id", "=", id)
    .execute();
}

export function consumeOtp(db: Db, id: string) {
  return db
    .updateTable("otp_codes")
    .set({ consumed_at: new Date() })
    .where("id", "=", id)
    .execute();
}

export function invalidateOtps(db: Db, userId: string, purpose: OtpPurpose) {
  return db
    .updateTable("otp_codes")
    .set({ consumed_at: new Date() })
    .where("user_id", "=", userId)
    .where("purpose", "=", purpose)
    .where("consumed_at", "is", null)
    .execute();
}

// --- Refresh tokens ---

export function insertRefreshToken(
  db: Db,
  input: {
    userId: string;
    tokenHash: string;
    familyId: string;
    parentId: string | null;
    expiresAt: Date;
  },
) {
  return db
    .insertInto("refresh_tokens")
    .values({
      user_id: input.userId,
      token_hash: input.tokenHash,
      family_id: input.familyId,
      parent_id: input.parentId,
      expires_at: input.expiresAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findRefreshByHash(db: Db, tokenHash: string) {
  return db
    .selectFrom("refresh_tokens")
    .selectAll()
    .where("token_hash", "=", tokenHash)
    .executeTakeFirst();
}

export function revokeRefreshToken(db: Db, id: string) {
  return db
    .updateTable("refresh_tokens")
    .set({ revoked_at: new Date() })
    .where("id", "=", id)
    .where("revoked_at", "is", null)
    .execute();
}

export function markRefreshReused(db: Db, id: string) {
  return db
    .updateTable("refresh_tokens")
    .set({ reused_at: new Date() })
    .where("id", "=", id)
    .execute();
}

export function revokeFamily(db: Db, familyId: string) {
  return db
    .updateTable("refresh_tokens")
    .set({ revoked_at: new Date() })
    .where("family_id", "=", familyId)
    .where("revoked_at", "is", null)
    .execute();
}

export function revokeAllUserTokens(db: Db, userId: string) {
  return db
    .updateTable("refresh_tokens")
    .set({ revoked_at: new Date() })
    .where("user_id", "=", userId)
    .where("revoked_at", "is", null)
    .execute();
}

// --- Cleanup ---

export async function deleteStaleOtps(db: Db, now: Date): Promise<number> {
  const res = await db
    .deleteFrom("otp_codes")
    .where((eb) =>
      eb.or([eb("consumed_at", "is not", null), eb("expires_at", "<", now)]),
    )
    .executeTakeFirst();
  return Number(res.numDeletedRows);
}

export async function deleteStaleRefreshTokens(db: Db, now: Date): Promise<number> {
  const res = await db
    .deleteFrom("refresh_tokens")
    .where((eb) =>
      eb.or([eb("revoked_at", "is not", null), eb("expires_at", "<", now)]),
    )
    .executeTakeFirst();
  return Number(res.numDeletedRows);
}

// --- Audit ---

export function insertEvent(
  db: Db,
  input: {
    userId: string | null;
    event: string;
    outcome: string;
    ip?: string | null;
    userAgent?: string | null;
  },
) {
  return db
    .insertInto("auth_events")
    .values({
      user_id: input.userId,
      event: input.event,
      outcome: input.outcome,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
    })
    .execute();
}
