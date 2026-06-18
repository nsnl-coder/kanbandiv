import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
import { AuthError } from "shared";
import { findPublicUserById } from "../features/auth/auth.repo.js";
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
  return t.middleware(({ ctx, path, next }) => {
    const now = Date.now();
    sweep(opts.windowMs, now);
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

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  // SESSION_EXPIRED marks an access-token problem the client can fix by
  // refreshing; domain UNAUTHORIZED errors (bad credentials) do not use it.
  const expired = new TRPCError({ code: "UNAUTHORIZED", message: AuthError.SESSION_EXPIRED });
  if (!ctx.userId) throw expired;
  const user = await findPublicUserById(ctx.db, ctx.userId);
  if (!user) throw expired;
  // Defense-in-depth: tokens are only issued post-verification, but never
  // trust a token for an unverified account.
  if (!user.email_verified) throw expired;
  return next({
    ctx: {
      ...ctx,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.email_verified,
      },
    },
  });
});
