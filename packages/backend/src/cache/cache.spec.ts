import { describe, expect, it } from "vitest";
import type Redis from "ioredis";
import { createCache } from "./cache.js";

// Minimal in-memory ioredis stand-in covering only the calls cache.ts makes.
function fakeRedis() {
  const store = new Map<string, string>();
  const ttl = new Map<string, number>();
  const client = {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async set(key: string, val: string) {
      store.set(key, val);
      return "OK";
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
    async incr(key: string) {
      const n = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(n));
      return n;
    },
    async expire(key: string, sec: number) {
      ttl.set(key, sec);
      return 1;
    },
    on() {},
    async quit() {
      return "OK";
    },
  };
  return { client, store, ttl };
}

const make = (f: { client: unknown }) => () => f.client as Redis;

describe("cache - no-op backend (no REDIS_URL)", () => {
  const cache = createCache({ redisUrl: "" });

  it("is disabled and always misses", async () => {
    expect(cache.enabled).toBe(false);
    expect(await cache.getJson("k")).toBeUndefined();
  });

  it("incrWithTtl returns 0 so the rate limiter falls back", async () => {
    expect(await cache.incrWithTtl("rl:x", 60)).toBe(0);
  });
});

describe("cache - redis backend", () => {
  it("round-trips JSON and deletes", async () => {
    const f = fakeRedis();
    const cache = createCache({ redisUrl: "redis://x", makeRedis: make(f) });
    expect(cache.enabled).toBe(true);

    await cache.setJson("auth:user:1", { id: "1", n: 2 }, 30);
    expect(await cache.getJson("auth:user:1")).toEqual({ id: "1", n: 2 });

    await cache.del("auth:user:1");
    expect(await cache.getJson("auth:user:1")).toBeUndefined();
  });

  it("incrWithTtl counts and sets TTL on first hit only", async () => {
    const f = fakeRedis();
    const cache = createCache({ redisUrl: "redis://x", makeRedis: make(f) });

    expect(await cache.incrWithTtl("rl:a", 60)).toBe(1);
    expect(f.ttl.get("rl:a")).toBe(60);
    expect(await cache.incrWithTtl("rl:a", 60)).toBe(2);
  });

  it("is best-effort: a throwing client never throws", async () => {
    const throwing = {
      client: {
        on() {},
        get() {
          throw new Error("down");
        },
        incr() {
          throw new Error("down");
        },
      },
    };
    const cache = createCache({ redisUrl: "redis://x", makeRedis: make(throwing) });
    expect(await cache.getJson("k")).toBeUndefined();
    expect(await cache.incrWithTtl("k", 60)).toBe(0);
  });
});
