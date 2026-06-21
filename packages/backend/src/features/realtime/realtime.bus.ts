import { EventEmitter } from "node:events";
import Redis from "ioredis";
import { type BoardEvent, boardEventSchema } from "shared";
import { env } from "../../config/env.config.js";
import { LogEvent } from "../../config/const.config.js";
import { logger } from "../../logger.js";

export type BoardEventListener = (event: BoardEvent) => void;

export interface Bus {
  subscribe(boardId: string, listener: BoardEventListener): () => void;
  publish(event: BoardEvent): void;
  close(): Promise<void>;
}

const CHANNEL_PREFIX = "board:";
const PATTERN = `${CHANNEL_PREFIX}*`;

export interface BusDeps {
  // Empty -> in-process EventEmitter; set -> ioredis pub/sub. Defaults to env.
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

// Transport-agnostic board-event bus with two backends selected by REDIS_URL.
// - empty: a single in-process EventEmitter (local dev, zero infra).
// - set: a publisher + a DEDICATED subscriber ioredis connection. The
//   subscriber PSUBSCRIBEs board:* once; Redis fans BETWEEN instances and the
//   local map fans WITHIN one. With Redis on, publish writes to Redis ONLY (the
//   originating instance receives its own pmessage), avoiding double-delivery.
export function createBus(deps: BusDeps = {}): Bus {
  const redisUrl = deps.redisUrl ?? env.REDIS_URL;
  const makeRedis = deps.makeRedis ?? defaultMakeRedis;
  const listeners = new Map<string, Set<BoardEventListener>>();

  function dispatch(event: BoardEvent): void {
    const set = listeners.get(event.boardId);
    if (!set) return;
    for (const l of set) {
      try {
        l(event);
      } catch (err) {
        logger.error({ err, event: LogEvent.RealtimePublishFailed }, LogEvent.RealtimePublishFailed);
      }
    }
  }

  function addListener(boardId: string, listener: BoardEventListener): () => void {
    let set = listeners.get(boardId);
    if (!set) {
      set = new Set();
      listeners.set(boardId, set);
    }
    set.add(listener);
    return () => {
      const s = listeners.get(boardId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) listeners.delete(boardId);
    };
  }

  // ----- in-process backend -----
  if (!redisUrl) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0); // many open tabs -> no leak warning
    return {
      subscribe(boardId, listener) {
        return addListener(boardId, listener);
      },
      publish(event) {
        try {
          dispatch(event);
        } catch (err) {
          logger.error({ err, event: LogEvent.RealtimePublishFailed }, LogEvent.RealtimePublishFailed);
        }
      },
      async close() {
        listeners.clear();
        emitter.removeAllListeners();
      },
    };
  }

  // ----- Redis backend (lazy; mirrors health.http.ts singleton options) -----
  let pub: Redis | null = null;
  let sub: Redis | null = null;
  let subscribed = false;

  function getPub(): Redis {
    if (!pub) {
      pub = makeRedis(redisUrl);
      pub.on("error", (err) =>
        logger.error({ err, event: LogEvent.RealtimeRedisError }, LogEvent.RealtimeRedisError),
      );
    }
    return pub;
  }

  function ensureSub(): void {
    if (subscribed) return;
    subscribed = true;
    sub = makeRedis(redisUrl);
    sub.on("error", (err) =>
      logger.error({ err, event: LogEvent.RealtimeRedisError }, LogEvent.RealtimeRedisError),
    );
    sub.on("pmessage", (_pattern: string, _channel: string, payload: string) => {
      try {
        const event = boardEventSchema.parse(JSON.parse(payload));
        dispatch(event);
      } catch (err) {
        logger.error(
          { err, event: LogEvent.RealtimeEventParseFailed },
          LogEvent.RealtimeEventParseFailed,
        );
      }
    });
    // Best-effort; on failure the error handler logs and same-instance map still serves.
    sub.psubscribe(PATTERN).catch((err) =>
      logger.error({ err, event: LogEvent.RealtimeRedisError }, LogEvent.RealtimeRedisError),
    );
  }

  return {
    subscribe(boardId, listener) {
      ensureSub();
      return addListener(boardId, listener);
    },
    publish(event) {
      try {
        getPub()
          .publish(CHANNEL_PREFIX + event.boardId, JSON.stringify(event))
          .catch((err) =>
            logger.error(
              { err, event: LogEvent.RealtimePublishFailed },
              LogEvent.RealtimePublishFailed,
            ),
          );
      } catch (err) {
        logger.error({ err, event: LogEvent.RealtimePublishFailed }, LogEvent.RealtimePublishFailed);
      }
    },
    async close() {
      listeners.clear();
      subscribed = false;
      const clients = [pub, sub].filter((c): c is Redis => c !== null);
      pub = null;
      sub = null;
      await Promise.allSettled(clients.map((c) => c.quit()));
    },
  };
}

// Module-level singleton imported by the SSE route and all publish call sites.
export const bus = createBus();
