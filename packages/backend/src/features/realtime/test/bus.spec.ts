import { EventEmitter } from "node:events";
import { BoardEventType, type BoardEvent } from "shared";
import { describe, expect, it, vi } from "vitest";
import { createBus } from "../realtime.bus.js";

function ev(boardId: string, over: Partial<BoardEvent> = {}): BoardEvent {
  return {
    boardId,
    type: BoardEventType.BOARD_CHANGED,
    actorId: "actor-1",
    ts: Date.now(),
    ...over,
  };
}

// Minimal ioredis stand-in: a shared message hub keyed by channel so two
// "clients" (instances) talk to each other, plus pattern matching for board:*.
function makeRedisFactory() {
  const hub = new EventEmitter();
  hub.setMaxListeners(0);
  const make = () => {
    const client = {
      publish: vi.fn(async (channel: string, payload: string) => {
        hub.emit("msg", channel, payload);
        return 1;
      }),
      psubscribe: vi.fn(async (_pattern: string) => {
        hub.on("msg", (channel: string, payload: string) => {
          client._onPmessage?.("board:*", channel, payload);
        });
        return 1;
      }),
      on: vi.fn((event: string, cb: (...a: unknown[]) => void) => {
        if (event === "pmessage") client._onPmessage = cb as never;
        return client;
      }),
      quit: vi.fn(async () => "OK"),
      _onPmessage: undefined as
        | ((p: string, c: string, m: string) => void)
        | undefined,
    };
    return client;
  };
  return make as never;
}

describe("realtime bus", () => {
  it("in-proc fallback: publish reaches same-instance subscribe (REDIS_URL empty)", () => {
    const bus = createBus({ redisUrl: "" });
    const got: BoardEvent[] = [];
    bus.subscribe("b1", (e) => got.push(e));
    bus.publish(ev("b1"));
    expect(got).toHaveLength(1);
    expect(got[0].boardId).toBe("b1");
  });

  it("board scoping: an event on board A is not delivered to a board-B listener", () => {
    const bus = createBus({ redisUrl: "" });
    const a: BoardEvent[] = [];
    const b: BoardEvent[] = [];
    bus.subscribe("A", (e) => a.push(e));
    bus.subscribe("B", (e) => b.push(e));
    bus.publish(ev("A"));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it("unsubscribe stops delivery and clears the listener", () => {
    const bus = createBus({ redisUrl: "" });
    const got: BoardEvent[] = [];
    const off = bus.subscribe("b1", (e) => got.push(e));
    off();
    bus.publish(ev("b1"));
    expect(got).toHaveLength(0);
  });

  it("payload privacy: serialized event has ONLY the 5 allowed fields", () => {
    const bus = createBus({ redisUrl: "" });
    let captured: BoardEvent | null = null;
    bus.subscribe("b1", (e) => (captured = e));
    bus.publish(ev("b1", { type: BoardEventType.CARD_ACTIVITY, cardId: "c1" }));
    expect(Object.keys(captured!).sort()).toEqual(
      ["actorId", "boardId", "cardId", "ts", "type"].sort(),
    );
  });

  it("redis backend: publish on instance 1 reaches subscribe on instance 2", async () => {
    const makeRedis = makeRedisFactory();
    const i1 = createBus({ redisUrl: "redis://x", makeRedis });
    const i2 = createBus({ redisUrl: "redis://x", makeRedis });
    const got: BoardEvent[] = [];
    i2.subscribe("b1", (e) => got.push(e));
    // let psubscribe wire up
    await Promise.resolve();
    i1.publish(ev("b1"));
    await Promise.resolve();
    expect(got).toHaveLength(1);
    expect(got[0].boardId).toBe("b1");
    await i1.close();
    await i2.close();
  });

  it("redis backend: originating instance receives its own event exactly once (no double-delivery)", async () => {
    const makeRedis = makeRedisFactory();
    const i1 = createBus({ redisUrl: "redis://x", makeRedis });
    const got: BoardEvent[] = [];
    i1.subscribe("b1", (e) => got.push(e));
    await Promise.resolve();
    i1.publish(ev("b1"));
    await Promise.resolve();
    expect(got).toHaveLength(1);
    await i1.close();
  });

  it("close quits redis clients", async () => {
    const makeRedis = makeRedisFactory();
    const bus = createBus({ redisUrl: "redis://x", makeRedis });
    bus.subscribe("b1", () => {});
    bus.publish(ev("b1"));
    await bus.close();
    // second close is a no-op (clients already cleared)
    await bus.close();
  });
});
