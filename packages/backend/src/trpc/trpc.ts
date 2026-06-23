import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { trace } from "@opentelemetry/api";
import type { OpenApiMeta } from "trpc-to-openapi";
import { AuthError, BackupError, Permission, RbacError, hasPermission } from "shared";
import { findPublicUserById, isTestEmail } from "../features/auth/auth.repo.js";
import { findUserGlobalPerms } from "../features/rbac/rbac.repo.js";
import { isMaintenance } from "../features/backup/backup.maintenance.js";
import { cache, cacheKeys } from "../cache/cache.js";
import { AUTH_CACHE_TTL_SEC } from "../config/const.config.js";
import type { Context } from "./context.js";

const t = initTRPC
  .context<Context>()
  .meta<OpenApiMeta>()
  .create({
    transformer: superjson,
    // Surface the active OTel traceId on every error so clients can show it
    // and users can quote it when reporting a bug (joins logs + Sentry).
    errorFormatter({ shape }) {
      const traceId = trace.getActiveSpan()?.spanContext().traceId ?? null;
      return { ...shape, data: { ...shape.data, traceId } };
    },
  });

export const router = t.router;
export const publicProcedure = t.procedure;

// --- per-IP rate limiting (in-memory sliding window) ---
const buckets = new Map<string, number[]>();

/** Test/ops helper: clear all rate-limit buckets (in-memory + Redis). */
export function resetRateLimits(): void {
  buckets.clear();
  // Best-effort, fire-and-forget; no-op when Redis is off (local/tests).
  void cache.delByPrefix("rl:");
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

export function rateLimit(opts: { limit: number; windowMs: number }) {
  return t.middleware(async ({ ctx, path, getRawInput, next }) => {
    const now = Date.now();
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
    const ip = ctx.ip ?? "unknown";
    // Redis backend: fixed-window counter shared across all instances. A Redis
    // failure returns 0 (fail-open) so an outage can't lock everyone out.
    if (cache.enabled) {
      const windowStart = Math.floor(now / opts.windowMs);
      const windowSec = Math.ceil(opts.windowMs / 1000);
      const hits = await cache.incrWithTtl(cacheKeys.rate(path, ip, windowStart), windowSec);
      if (hits > opts.limit) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });
      }
      return next();
    }
    // In-memory fallback (local dev / tests): single-process sliding window.
    sweep(opts.windowMs, now);
    const key = `${path}:${ip}`;
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

// Cached identity+perms shape. perms is an array on the wire (JSON has no Set)
// and rehydrated to a Set below to match findUserGlobalPerms.
type CachedAuthUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  isSuperuser: boolean;
  permissions: Permission[];
};

const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  // SESSION_EXPIRED marks an access-token problem the client can fix by
  // refreshing; domain UNAUTHORIZED errors (bad credentials) do not use it.
  const expired = new TRPCError({ code: "UNAUTHORIZED", message: AuthError.SESSION_EXPIRED });
  if (!ctx.userId) throw expired;

  // Cache hit skips both DB reads (findPublicUserById + findUserGlobalPerms),
  // which otherwise run on EVERY protected request. TTL is short and the cache
  // is invalidated on identity/permission changes, so staleness is bounded.
  const key = cacheKeys.authUser(ctx.userId);
  let cached = await cache.getJson<CachedAuthUser>(key);
  if (!cached) {
    const user = await findPublicUserById(ctx.db, ctx.userId);
    if (!user) throw expired;
    const { isSuperuser, perms } = await findUserGlobalPerms(ctx.db, user.id);
    cached = {
      id: user.id,
      email: user.email,
      emailVerified: user.email_verified,
      isSuperuser,
      permissions: [...perms],
    };
    await cache.setJson(key, cached, AUTH_CACHE_TTL_SEC);
  }
  // Defense-in-depth: tokens are only issued post-verification, but never
  // trust a token for an unverified account.
  if (!cached.emailVerified) throw expired;
  return next({
    ctx: {
      ...ctx,
      user: {
        id: cached.id,
        email: cached.email,
        emailVerified: cached.emailVerified,
        isSuperuser: cached.isSuperuser,
        permissions: new Set(cached.permissions),
      },
    },
  });
});

/**
 * Authenticates the session WITHOUT the email_verified gate or maintenance
 * check. Only used to exit impersonation: an admin must always be able to
 * return to their own account even when impersonating an unverified user
 * (whose session authedProcedure would reject with SESSION_EXPIRED).
 */
export const sessionProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: AuthError.SESSION_EXPIRED });
  }
  return next();
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

/** Protected procedure restricted to superusers (e.g. impersonation). */
export const superuserProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isSuperuser) {
    throw new TRPCError({ code: "FORBIDDEN", message: RbacError.FORBIDDEN });
  }
  return next();
});
