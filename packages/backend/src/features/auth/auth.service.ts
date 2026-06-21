import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import {
  AuthError,
  OtpPurpose,
  RESET_OTP_LENGTH,
  VERIFY_OTP_LENGTH,
  type AuthTokens,
  type ChangePasswordInput,
  type LoginInput,
  type PublicUser,
  type RegisterInput,
  type ResetPasswordInput,
} from "shared";
import { env } from "../../config/env.config.js";
import type { EmailPort } from "../email/email.service.js";
import { findUserGlobalPerms } from "../rbac/rbac.repo.js";
import * as invite from "../invite/invite.service.js";
import * as repo from "./auth.repo.js";
import type { Db } from "./auth.repo.js";

export interface AuthDeps {
  db: Db;
  email: EmailPort;
  ip?: string | null;
  userAgent?: string | null;
}

/** Record an audit event, attaching the request IP/user-agent from deps. */
function logEvent(
  deps: AuthDeps,
  e: { userId: string | null; event: string; outcome: string },
) {
  return repo.insertEvent(deps.db, {
    ...e,
    ip: deps.ip ?? null,
    userAgent: deps.userAgent ?? null,
  });
}

export const AUTH_CONSTANTS = {
  OTP_TTL_MS: 10 * 60 * 1000,
  MAX_OTP_ATTEMPTS: 5,
  RESEND_WINDOW_MS: 60 * 60 * 1000,
  RESEND_CAP: 3,
  MAX_FAILED_LOGINS: 10,
  LOCK_MS: 15 * 60 * 1000,
} as const;

const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", env.BCRYPT_COST);

// --- password ---

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, env.BCRYPT_COST);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

// --- otp ---

export function generateOtp(length: number): string {
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, "0");
}

function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, env.BCRYPT_COST);
}

// --- tokens ---

interface AccessPayload {
  sub: string;
  email: string;
}

export function signAccessToken(user: PublicUser): string {
  const payload: AccessPayload = { sub: user.id, email: user.email };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: env.JWT_ISS,
    audience: env.JWT_AUD,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
    issuer: env.JWT_ISS,
    audience: env.JWT_AUD,
  }) as AccessPayload;
}

function generateRefreshRaw(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashRefresh(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function issueRefreshToken(
  db: Db,
  userId: string,
  familyId: string,
  parentId: string | null,
): Promise<string> {
  const raw = generateRefreshRaw();
  await repo.insertRefreshToken(db, {
    userId,
    tokenHash: hashRefresh(raw),
    familyId,
    parentId,
    expiresAt: new Date(Date.now() + env.REFRESH_TTL_MS),
  });
  return raw;
}

async function toPublicUser(
  db: Db,
  row: {
    id: string;
    email: string;
    is_superuser: boolean;
    role_id: string | null;
    email_verified: boolean;
  },
): Promise<PublicUser> {
  const { isSuperuser, perms } = await findUserGlobalPerms(db, row.id);
  return {
    id: row.id,
    email: row.email,
    isSuperuser,
    roleId: row.role_id,
    emailVerified: row.email_verified,
    permissions: [...perms],
  };
}

async function issueTokens(db: Db, user: PublicUser): Promise<AuthTokens> {
  const familyId = crypto.randomUUID();
  const refreshToken = await issueRefreshToken(db, user.id, familyId, null);
  return { accessToken: signAccessToken(user), refreshToken, user };
}

// --- OTP issue/verify helpers ---

async function issueOtp(
  deps: AuthDeps,
  userId: string,
  purpose: OtpPurpose,
): Promise<string> {
  const length =
    purpose === OtpPurpose.ResetPassword ? RESET_OTP_LENGTH : VERIFY_OTP_LENGTH;
  await repo.invalidateOtps(deps.db, userId, purpose);
  const code = generateOtp(length);
  await repo.insertOtp(deps.db, {
    userId,
    codeHash: await hashOtp(code),
    purpose,
    expiresAt: new Date(Date.now() + AUTH_CONSTANTS.OTP_TTL_MS),
  });
  await logEvent(deps, { userId, event: "otp_issue", outcome: purpose });
  return code;
}

/** Validates + consumes an OTP. Throws INVALID_OTP on any failure. */
async function consumeValidOtp(
  deps: AuthDeps,
  userId: string,
  purpose: OtpPurpose,
  code: string,
): Promise<void> {
  const db = deps.db;
  const otp = await repo.latestActiveOtp(db, userId, purpose);
  if (!otp) throw badOtp();
  if (new Date(otp.expires_at).getTime() < Date.now()) throw badOtp();

  const ok = await bcrypt.compare(code, otp.code_hash);
  if (!ok) {
    const attempts = otp.attempts + 1;
    await repo.incOtpAttempts(db, otp.id);
    if (attempts >= AUTH_CONSTANTS.MAX_OTP_ATTEMPTS) {
      await repo.consumeOtp(db, otp.id); // lock: invalidate
    }
    await logEvent(deps, { userId, event: "otp_verify", outcome: "fail" });
    throw badOtp();
  }
  await repo.consumeOtp(db, otp.id);
}

function badOtp() {
  return new TRPCError({ code: "BAD_REQUEST", message: AuthError.INVALID_OTP });
}

async function enforceResendLimit(
  db: Db,
  userId: string,
  purpose: OtpPurpose,
): Promise<void> {
  const since = new Date(Date.now() - AUTH_CONSTANTS.RESEND_WINDOW_MS);
  const count = await repo.countOtpSince(db, userId, purpose, since);
  if (count >= AUTH_CONSTANTS.RESEND_CAP) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: AuthError.RATE_LIMITED });
  }
}

// --- endpoints ---

export async function register(
  deps: AuthDeps,
  input: RegisterInput,
): Promise<{ ok: true }> {
  const existing = await repo.findUserByEmail(deps.db, input.email);
  if (existing) {
    if (existing.email_verified) {
      throw new TRPCError({ code: "CONFLICT", message: AuthError.EMAIL_TAKEN });
    }
    // Unverified re-register: re-issue a fresh verify OTP (account recovery).
    // Resend cap bounds OTP re-minting so it can't reset the per-OTP attempt limit.
    await enforceResendLimit(deps.db, existing.id, OtpPurpose.VerifyEmail);
    const code = await issueOtp(deps, existing.id, OtpPurpose.VerifyEmail);
    try {
      await deps.email.sendVerifyOtp(existing.email, code);
    } catch (cause) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: AuthError.EMAIL_SEND_FAILED, cause });
    }
    return { ok: true };
  }

  const user = await repo.createUser(deps.db, {
    email: input.email,
    passwordHash: await hashPassword(input.password),
  });
  const code = await issueOtp(deps, user.id, OtpPurpose.VerifyEmail);
  try {
    await deps.email.sendVerifyOtp(user.email, code);
  } catch (cause) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: AuthError.EMAIL_SEND_FAILED, cause });
  }
  await logEvent(deps, { userId: user.id, event: "register", outcome: "success" });
  return { ok: true };
}

export async function verifyEmail(
  deps: AuthDeps,
  input: { email: string; otp: string },
): Promise<{ ok: true }> {
  const user = await repo.findUserByEmail(deps.db, input.email);
  if (!user) {
    await bcrypt.compare(input.otp, DUMMY_HASH); // timing parity
    throw badOtp();
  }
  if (user.email_verified) {
    throw new TRPCError({ code: "BAD_REQUEST", message: AuthError.ALREADY_VERIFIED });
  }
  await consumeValidOtp(deps, user.id, OtpPurpose.VerifyEmail, input.otp);
  await repo.setEmailVerified(deps.db, user.id);
  // Apply any pending invites addressed to this email (best-effort, never throws).
  await invite.consumeForEmail(deps.db, user.id, user.email);
  return { ok: true };
}

export async function resendVerifyOtp(
  deps: AuthDeps,
  input: { email: string },
): Promise<{ ok: true }> {
  const user = await repo.findUserByEmail(deps.db, input.email);
  // Silent for unknown email (no enumeration).
  if (!user || user.email_verified) return { ok: true };
  await enforceResendLimit(deps.db, user.id, OtpPurpose.VerifyEmail);
  const code = await issueOtp(deps, user.id, OtpPurpose.VerifyEmail);
  await deps.email.sendVerifyOtp(user.email, code);
  return { ok: true };
}

export async function login(
  deps: AuthDeps,
  input: LoginInput,
): Promise<AuthTokens> {
  const user = await repo.findUserByEmail(deps.db, input.email);
  if (!user) {
    await bcrypt.compare(input.password, DUMMY_HASH); // timing parity
    throw invalidCredentials();
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new TRPCError({ code: "FORBIDDEN", message: AuthError.ACCOUNT_LOCKED });
  }

  const ok = await verifyPassword(input.password, user.password_hash);
  if (!ok) {
    const count = user.failed_login_count + 1;
    const lock =
      count >= AUTH_CONSTANTS.MAX_FAILED_LOGINS
        ? new Date(Date.now() + AUTH_CONSTANTS.LOCK_MS)
        : null;
    await repo.setFailedLogin(deps.db, user.id, count, lock);
    await logEvent(deps, { userId: user.id, event: "login", outcome: "fail" });
    if (lock) await deps.email.sendAccountLocked(user.email);
    throw invalidCredentials();
  }

  if (!user.email_verified) {
    throw new TRPCError({ code: "FORBIDDEN", message: AuthError.EMAIL_NOT_VERIFIED });
  }

  await repo.resetFailedLogin(deps.db, user.id);
  await logEvent(deps, { userId: user.id, event: "login", outcome: "success" });
  return issueTokens(deps.db, await toPublicUser(deps.db, user));
}

export async function refresh(
  deps: AuthDeps,
  rawToken: string,
): Promise<AuthTokens> {
  const row = await repo.findRefreshByHash(deps.db, hashRefresh(rawToken));
  if (!row) throw invalidRefresh();

  if (row.revoked_at) {
    // Reuse of a rotated/revoked token -> theft signal: kill the family.
    await repo.markRefreshReused(deps.db, row.id);
    await repo.revokeFamily(deps.db, row.family_id);
    await logEvent(deps, {
      userId: row.user_id,
      event: "refresh_reuse",
      outcome: "blocked",
    });
    throw invalidRefresh();
  }

  if (new Date(row.expires_at).getTime() < Date.now()) throw invalidRefresh();

  // Scoped select (no password_hash) since rotation only needs public fields.
  const user = await repo.findPublicUserById(deps.db, row.user_id);
  if (!user) throw invalidRefresh();

  await repo.revokeRefreshToken(deps.db, row.id);
  const newRaw = await issueRefreshToken(deps.db, user.id, row.family_id, row.id);
  const publicUser = await toPublicUser(deps.db, user);
  return {
    accessToken: signAccessToken(publicUser),
    refreshToken: newRaw,
    user: publicUser,
  };
}

export async function logout(
  deps: AuthDeps,
  rawToken: string,
): Promise<{ ok: true }> {
  const row = await repo.findRefreshByHash(deps.db, hashRefresh(rawToken));
  if (row && !row.revoked_at) await repo.revokeRefreshToken(deps.db, row.id);
  return { ok: true };
}

export async function forgotPassword(
  deps: AuthDeps,
  input: { email: string },
): Promise<{ ok: true }> {
  const user = await repo.findUserByEmail(deps.db, input.email);
  if (!user) return { ok: true }; // no enumeration
  await enforceResendLimit(deps.db, user.id, OtpPurpose.ResetPassword);
  const code = await issueOtp(deps, user.id, OtpPurpose.ResetPassword);
  await deps.email.sendResetOtp(user.email, code);
  return { ok: true };
}

export async function resetPassword(
  deps: AuthDeps,
  input: ResetPasswordInput,
): Promise<{ ok: true }> {
  const user = await repo.findUserByEmail(deps.db, input.email);
  if (!user) {
    await bcrypt.compare(input.otp, DUMMY_HASH); // timing parity
    throw badOtp();
  }
  await consumeValidOtp(deps, user.id, OtpPurpose.ResetPassword, input.otp);
  await repo.updatePassword(deps.db, user.id, await hashPassword(input.newPassword));
  await repo.revokeAllUserTokens(deps.db, user.id);
  await logEvent(deps, {
    userId: user.id,
    event: "reset_password",
    outcome: "success",
  });
  return { ok: true };
}

export async function changePassword(
  deps: AuthDeps,
  userId: string,
  input: ChangePasswordInput,
): Promise<{ ok: true }> {
  const user = await repo.findUserById(deps.db, userId);
  if (!user) throw invalidCredentials();
  const ok = await verifyPassword(input.currentPassword, user.password_hash);
  if (!ok) throw invalidCredentials();
  await repo.updatePassword(deps.db, user.id, await hashPassword(input.newPassword));
  await repo.revokeAllUserTokens(deps.db, user.id);
  return { ok: true };
}

/** Purge consumed/expired OTPs and revoked/expired refresh tokens. */
export async function cleanupExpired(
  db: Db,
): Promise<{ otps: number; tokens: number }> {
  const now = new Date();
  return {
    otps: await repo.deleteStaleOtps(db, now),
    tokens: await repo.deleteStaleRefreshTokens(db, now),
  };
}

export async function getMe(deps: AuthDeps, userId: string): Promise<PublicUser> {
  const user = await repo.findPublicUserById(deps.db, userId);
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return toPublicUser(deps.db, user);
}

function invalidCredentials() {
  return new TRPCError({ code: "UNAUTHORIZED", message: AuthError.INVALID_CREDENTIALS });
}

function invalidRefresh() {
  return new TRPCError({ code: "UNAUTHORIZED", message: AuthError.INVALID_REFRESH_TOKEN });
}
