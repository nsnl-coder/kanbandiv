import { Router } from "express";
import { sql } from "kysely";
import Redis from "ioredis";
import { appDb } from "../../db/index.js";
import { env } from "../../config/env.config.js";
import { logger } from "../../logger.js";

export const healthHttpRouter = Router();

// Liveness: no deps. Used by Docker HEALTHCHECK + nginx upstream checks.
// Not logged (would flood) - logging is skipped here by design.
healthHttpRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Lazy singleton; only created when REDIS_URL is configured (off locally).
let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    redis.on("error", () => {}); // swallow; readiness reports the failure
  }
  return redis;
}

async function checkPostgres(): Promise<void> {
  await sql`select 1`.execute(appDb);
}

async function checkRedis(): Promise<void> {
  const r = getRedis();
  if (r.status !== "ready") await r.connect();
  await r.ping();
}

async function checkMinio(): Promise<void> {
  const res = await fetch(`${env.MINIO_ENDPOINT}/minio/health/live`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`minio ${res.status}`);
}

// Readiness: only ready when every CONFIGURED dependency is reachable. Deps with
// no URL (e.g. redis/minio locally) are skipped, so local stays green.
healthHttpRouter.get("/health/ready", async (_req, res) => {
  const checks: Array<[string, Promise<void>]> = [["postgres", checkPostgres()]];
  if (env.REDIS_URL) checks.push(["redis", checkRedis()]);
  if (env.MINIO_ENDPOINT) checks.push(["minio", checkMinio()]);

  const results = await Promise.allSettled(checks.map(([, p]) => p));
  const failed = checks
    .map(([name], i) => (results[i].status === "rejected" ? name : null))
    .filter((n): n is string => n !== null);

  if (failed.length === 0) {
    res.json({ status: "ok" });
    return;
  }
  // Only log on failure, never on healthy probes.
  logger.error({ failed }, "readiness check failed");
  res.status(503).json({ status: "error", failed });
});
