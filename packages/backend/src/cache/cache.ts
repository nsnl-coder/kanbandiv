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
  logger.error({ err, event: LogEvent.CacheError }, LogEvent.CacheError);
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

  // ----- Redis backend (lazy; mirrors realtime.bus.ts client options) -----
  let client: Redis | null = null;

  function get(): Redis {
    if (!client) {
      client = makeRedis(redisUrl);
      client.on("error", logCacheError);
    }
    return client;
  }

  return {
    enabled: true,
    async getJson<T>(key: string): Promise<T | undefined> {
      try {
        const raw = await get().get(key);
        return raw == null ? undefined : (JSON.parse(raw) as T);
      } catch (err) {
        logCacheError(err);
        return undefined;
      }
    },
    async setJson(key, value, ttlSec) {
      try {
        await get().set(key, JSON.stringify(value), "EX", ttlSec);
      } catch (err) {
        logCacheError(err);
      }
    },
    async del(...keys) {
      if (keys.length === 0) return;
      try {
        await get().del(...keys);
      } catch (err) {
        logCacheError(err);
      }
    },
    async incrWithTtl(key, ttlSec) {
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
