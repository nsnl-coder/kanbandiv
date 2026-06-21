import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAuthStore } from "../../../hooks/useAuthStore";
import type { PublicUser } from "shared";

const h = vi.hoisted(() => ({
  invalidated: [] as unknown[][],
  refresh: vi.fn<[], Promise<boolean>>(() => Promise.resolve(true)),
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryKey: (input?: unknown) => [path, input],
  });
  const proxy = new Proxy({}, { get: () => new Proxy({}, { get: (_t, ep: string) => leaf(ep) }) });
  return { useTRPC: () => proxy, refreshSession: () => h.refresh() };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: (opts: { queryKey: unknown[] }) => {
      h.invalidated.push(opts.queryKey);
    },
  }),
}));

vi.mock("../../../config/env.config", () => ({
  config: { apiBaseUrl: "http://api.test/api" },
}));

// Recording EventSource fake (jsdom has none).
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }
  open() {
    this.onopen?.(new Event("open"));
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
  error() {
    this.onerror?.(new Event("error"));
  }
  close() {
    this.closed = true;
  }
}
vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

const { useBoardRealtime } = await import("./useBoardRealtime");

const me: PublicUser = {
  id: "me",
  email: "me@x.io",
  isSuperuser: false,
  roleId: null,
  emailVerified: true,
  permissions: [],
};

const last = () => FakeEventSource.instances[FakeEventSource.instances.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  h.invalidated = [];
  h.refresh = vi.fn<[], Promise<boolean>>(() => Promise.resolve(true));
  FakeEventSource.instances = [];
  useAuthStore.getState().setAuth(me);
});

afterEach(() => {
  vi.useRealTimers();
});

const remote = (over: Record<string, unknown> = {}) => ({
  boardId: "b1",
  type: "BOARD_CHANGED",
  actorId: "other",
  ts: 1,
  ...over,
});

describe("useBoardRealtime", () => {
  it("opens the stream to the right URL with credentials", () => {
    renderHook(() => useBoardRealtime("b1"));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(last().url).toBe("http://api.test/api/boards/b1/events");
    expect(last().withCredentials).toBe(true);
  });

  it("no-ops without a boardId", () => {
    renderHook(() => useBoardRealtime(undefined));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("invalidates boards.getData on BOARD_CHANGED", () => {
    renderHook(() => useBoardRealtime("b1"));
    last().emit(remote());
    vi.advanceTimersByTime(250);
    expect(h.invalidated).toContainEqual(["getData", { id: "b1" }]);
  });

  it("invalidates both keys on CARD_ACTIVITY with cardId", () => {
    renderHook(() => useBoardRealtime("b1"));
    last().emit(remote({ type: "CARD_ACTIVITY", cardId: "k1" }));
    vi.advanceTimersByTime(250);
    expect(h.invalidated).toContainEqual(["getData", { id: "b1" }]);
    expect(h.invalidated).toContainEqual(["listForCard", { cardId: "k1" }]);
  });

  it("skips self-echo (actorId === me)", () => {
    renderHook(() => useBoardRealtime("b1"));
    last().emit(remote({ actorId: "me" }));
    vi.advanceTimersByTime(250);
    expect(h.invalidated).toHaveLength(0);
  });

  it("debounces a burst into one invalidation per key", () => {
    renderHook(() => useBoardRealtime("b1"));
    last().emit(remote());
    last().emit(remote());
    last().emit(remote());
    vi.advanceTimersByTime(250);
    const boardKeys = h.invalidated.filter((k) => k[0] === "getData");
    expect(boardKeys).toHaveLength(1);
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useBoardRealtime("b1"));
    const es = last();
    unmount();
    expect(es.closed).toBe(true);
  });

  it("closes the old stream and opens a new one on board change", () => {
    const { rerender } = renderHook(({ id }) => useBoardRealtime(id), {
      initialProps: { id: "b1" },
    });
    const first = last();
    rerender({ id: "b2" });
    expect(first.closed).toBe(true);
    expect(last().url).toBe("http://api.test/api/boards/b2/events");
  });

  it("does not close on a single transient error; reopen catch-up invalidates", () => {
    renderHook(() => useBoardRealtime("b1"));
    const es = last();
    es.open(); // first open: no catch-up
    expect(h.invalidated).toHaveLength(0);
    es.error(); // single error: must NOT close
    expect(es.closed).toBe(false);
    es.open(); // reconnect: one catch-up invalidation
    vi.advanceTimersByTime(250);
    expect(h.invalidated.filter((k) => k[0] === "getData")).toHaveLength(1);
  });

  it("on repeated errors refreshes then reopens (refresh ok)", async () => {
    renderHook(() => useBoardRealtime("b1"));
    const es = last();
    es.error();
    es.error(); // 2nd consecutive -> refresh
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(es.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(last().closed).toBe(false);
  });

  it("on repeated errors with dead refresh closes and does not reopen", async () => {
    h.refresh = vi.fn<[], Promise<boolean>>(() => Promise.resolve(false));
    renderHook(() => useBoardRealtime("b1"));
    const es = last();
    es.error();
    es.error();
    await vi.runAllTimersAsync();
    expect(es.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
