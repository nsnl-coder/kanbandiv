import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
import { AuthError, BackupError, Permission, RbacError, hasPermission } from "shared";
import { findPublicUserById, isTestEmail } from "../features/auth/auth.repo.js";
import { findUserGlobalPerms } from "../features/rbac/rbac.repo.js";
import { isMaintenance } from "../features/backup/backup.maintenance.js";
import type { Context } from "./context.js";

const t = initTRPC.context<Context>().meta<OpenApiMeta>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

// --- per-IP rate limiting (in-memory sliding window) ---
const buckets = new Map<string, number[]>();

/** Test/ops helper: clear all rate-limit buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}

let lastSweep = Date.now();

// Drop empty/stale buckets so the map can't grow unbounded across distinct IPs.
function sweep(windowMs: number, now: number): void {
  if (now - lastSweep < windowMs) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    const live = v.filter((ts) => ts > now - windowMs);
    if (live.length === 0) buckets.delete(k);
    else buckets.set(k, live);
  }
}

function rateLimit(opts: { limit: number; windowMs: number }) {
  return t.middleware(async ({ ctx, path, getRawInput, next }) => {
    const now = Date.now();
    sweep(opts.windowMs, now);
    // Exempt dedicated e2e test accounts (users.is_test): the suite hammers
    // login from one IP behind Cloudflare, which collapses the per-test
    // X-Forwarded-For into a single bucket. Only auth inputs carry an email.
    const raw = (await getRawInput().catch(() => undefined)) as
      | { email?: unknown }
      | undefined;
    if (typeof raw?.email === "string" && (await isTestEmail(ctx.db, raw.email))) {
      return next();
    }
    // Missing IP shares one restrictive bucket; never bypass the limiter.
    const key = `${path}:${ctx.ip ?? "unknown"}`;
    const hits = (buckets.get(key) ?? []).filter((ts) => ts > now - opts.windowMs);
    if (hits.length >= opts.limit) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });
    }
    hits.push(now);
    buckets.set(key, hits);
    return next();
  });
}

/** Public procedure with a per-IP rate limit applied. */
export const rateLimitedProcedure = (limit: number, windowMs = 60_000) =>
  t.procedure.use(rateLimit({ limit, windowMs }));

const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  // SESSION_EXPIRED marks an access-token problem the client can fix by
  // refreshing; domain UNAUTHORIZED errors (bad credentials) do not use it.
  const expired = new TRPCError({ code: "UNAUTHORIZED", message: AuthError.SESSION_EXPIRED });
  if (!ctx.userId) throw expired;
  const user = await findPublicUserById(ctx.db, ctx.userId);
  if (!user) throw expired;
  // Defense-in-depth: tokens are only issued post-verification, but never
  // trust a token for an unverified account.
  if (!user.email_verified) throw expired;
  const { isSuperuser, perms } = await findUserGlobalPerms(ctx.db, user.id);
  return next({
    ctx: {
      ...ctx,
      user: {
        id: user.id,
        email: user.email,
        emailVerified: user.email_verified,
        isSuperuser,
        permissions: perms,
      },
    },
  });
});

/**
 * While maintenance mode is on, only superusers and backup admins (who can turn
 * it off / run the restore) may proceed; everyone else gets SERVICE_UNAVAILABLE.
 */
export const protectedProcedure = authedProcedure.use(({ ctx, next }) => {
  if (
    isMaintenance() &&
    !ctx.user.isSuperuser &&
    !hasPermission(ctx.user.permissions, Permission.AdminBackupManage) &&
    !hasPermission(ctx.user.permissions, Permission.AdminBackupRead)
  ) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: BackupError.MAINTENANCE });
  }
  return next();
});

/**
 * Protected procedure guarded by a global permission. Superusers bypass the
 * check; everyone else must hold the permission or get FORBIDDEN.
 */
export const globalProcedure = (permission: Permission) =>
  protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.user.isSuperuser && !hasPermission(ctx.user.permissions, permission)) {
      throw new TRPCError({ code: "FORBIDDEN", message: RbacError.FORBIDDEN });
    }
    return next();
  });
