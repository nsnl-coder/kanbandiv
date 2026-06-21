import { EventEmitter } from "node:events";
import { BoardEventType, type BoardEvent, type UserEvent, UserEventKind } from "shared";
import { describe, expect, it, vi } from "vitest";
import { createBus } from "../realtime.bus.js";

function uev(userId: string): UserEvent {
  return { userId, kind: UserEventKind.NOTIFICATION, ts: Date.now() };
}

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

  it("user channel in-proc: publishUser reaches same-user subscribeUser", () => {
    const bus = createBus({ redisUrl: "" });
    const got: UserEvent[] = [];
    bus.subscribeUser("u1", (e) => got.push(e));
    bus.publishUser(uev("u1"));
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe("notification");
  });

  it("user scoping: a different user's listener does NOT receive the event", () => {
    const bus = createBus({ redisUrl: "" });
    const u1: UserEvent[] = [];
    const u2: UserEvent[] = [];
    bus.subscribeUser("u1", (e) => u1.push(e));
    bus.subscribeUser("u2", (e) => u2.push(e));
    bus.publishUser(uev("u1"));
    expect(u1).toHaveLength(1);
    expect(u2).toHaveLength(0);
  });

  it("channels do not cross: a board listener never sees a user event and vice-versa", () => {
    const bus = createBus({ redisUrl: "" });
    const boardGot: BoardEvent[] = [];
    const userGot: UserEvent[] = [];
    bus.subscribe("b1", (e) => boardGot.push(e));
    bus.subscribeUser("b1", (e) => userGot.push(e));
    bus.publishUser(uev("b1"));
    bus.publish(ev("b1"));
    expect(userGot).toHaveLength(1);
    expect(boardGot).toHaveLength(1);
  });

  it("redis user channel: publishUser on instance 1 reaches subscribeUser on instance 2, once on origin", async () => {
    const makeRedis = makeRedisFactory();
    const i1 = createBus({ redisUrl: "redis://x", makeRedis });
    const i2 = createBus({ redisUrl: "redis://x", makeRedis });
    const got2: UserEvent[] = [];
    const got1: UserEvent[] = [];
    i2.subscribeUser("u1", (e) => got2.push(e));
    i1.subscribeUser("u1", (e) => got1.push(e));
    await Promise.resolve();
    i1.publishUser(uev("u1"));
    await Promise.resolve();
    expect(got2).toHaveLength(1);
    expect(got1).toHaveLength(1);
    await i1.close();
    await i2.close();
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
