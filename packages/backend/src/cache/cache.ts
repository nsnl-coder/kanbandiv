import Redis from "ioredis";
import { env } from "../config/env.config.js";
import { LogEvent } from "../config/const.config.js";
import { logger } from "../logger.js";

// Thin best-effort cache with two backends selected by REDIS_URL, mirroring the
// realtime bus. No REDIS_URL -> a no-op cache (`enabled: false`): reads always
// miss and writes are dropped, so every caller falls through to Postgres (local
// dev, zero infra). REDIS_URL set -> a single lazy ioredis client. EVERY method
// is best-effort: a Redis failure is logged and swallowed (miss/undefined/0) so
// caching can never break a request.
export interface Cache {
  // false in no-op mode; callers can branch to keep their DB-only fallback.
  readonly enabled: boolean;
  getJson<T>(key: string): Promise<T | undefined>;
  setJson(key: string, value: unknown, ttlSec: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  // INCR + first-hit EXPIRE; returns the post-increment count (0 on failure).
  incrWithTtl(key: string, ttlSec: number): Promise<number>;
  // Best-effort SCAN + DEL of every key matching `prefix*` (ops/test helper).
  delByPrefix(prefix: string): Promise<void>;
  close(): Promise<void>;
}

export interface CacheDeps {
  // Empty -> no-op cache; set -> ioredis. Defaults to env.
  redisUrl?: string;
  // Inject a factory for tests (mock ioredis). Defaults to real ioredis.
  makeRedis?: (url: string) => Redis;
}

function defaultMakeRedis(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

function logCacheError(err: unknown): void {
  // warn, not error: a degraded cache is non-fatal (callers fall back to DB),
  // so it must not page or flood Sentry.
  logger.warn({ err, event: LogEvent.CacheError }, LogEvent.CacheError);
}

export function createCache(deps: CacheDeps = {}): Cache {
  const redisUrl = deps.redisUrl ?? env.REDIS_URL;
  const makeRedis = deps.makeRedis ?? defaultMakeRedis;

  // ----- no-op backend -----
  if (!redisUrl) {
    return {
      enabled: false,
      async getJson() {
        return undefined;
      },
      async setJson() {},
      async del() {},
      async incrWithTtl() {
        return 0;
      },
      async delByPrefix() {},
      async close() {},
    };
  }

  // ----- Redis backend -----
  // lazyConnect + enableOfflineQueue:false make any command issued before the
  // socket is open throw ("Stream isn't writeable"). On a hot path that is error
  // spam on every restart plus an uncached cold window. So we connect eagerly
  // and gate every op on a `ready` flag: until the connection is open (or after
  // it drops) we skip Redis and let the caller hit the DB - no doomed command,
  // no log spam, instant fallback when Redis is down.
  let client: Redis | null = null;
  let ready = false;

  function get(): Redis {
    if (!client) {
      const c = makeRedis(redisUrl);
      c.on("ready", () => {
        ready = true;
      });
      c.on("end", () => {
        ready = false;
      });
      c.on("error", (err) => {
        ready = false;
        logCacheError(err);
      });
      client = c;
      // Kick off the (lazy) connection now so the cache is warm before traffic.
      c.connect().catch(() => {});
    }
    return client;
  }

  // Start connecting at construction (no-op factories in tests just set ready).
  get();

  return {
    enabled: true,
    async getJson<T>(key: string): Promise<T | undefined> {
      if (!ready) return undefined;
      try {
        const raw = await get().get(key);
        return raw == null ? undefined : (JSON.parse(raw) as T);
      } catch (err) {
        logCacheError(err);
        return undefined;
      }
    },
    async setJson(key, value, ttlSec) {
      if (!ready) return;
      try {
        await get().set(key, JSON.stringify(value), "EX", ttlSec);
      } catch (err) {
        logCacheError(err);
      }
    },
    async del(...keys) {
      if (!ready || keys.length === 0) return;
      try {
        await get().del(...keys);
      } catch (err) {
        logCacheError(err);
      }
    },
    async incrWithTtl(key, ttlSec) {
      if (!ready) return 0;
      try {
        const n = await get().incr(key);
        if (n === 1) await get().expire(key, ttlSec);
        return n;
      } catch (err) {
        logCacheError(err);
        return 0;
      }
    },
    async delByPrefix(prefix) {
      if (!ready) return;
      try {
        const c = get();
        let cursor = "0";
        do {
          const [next, keys] = await c.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
          cursor = next;
          if (keys.length > 0) await c.del(...keys);
        } while (cursor !== "0");
      } catch (err) {
        logCacheError(err);
      }
    },
    async close() {
      if (!client) return;
      const c = client;
      client = null;
      ready = false;
      await c.quit().catch(() => {});
    },
  };
}

// Module-level singleton imported by trpc + feature services.
export const cache = createCache();

// Key builders: one place so producers and invalidators can't drift.
export const cacheKeys = {
  authUser: (userId: string) => `auth:user:${userId}`,
  notifUnread: (userId: string) => `notif:unread:${userId}`,
  rate: (path: string, ip: string, windowStart: number) => `rl:${path}:${ip}:${windowStart}`,
};
