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
    queryKey: (input?: unknown) => (input === undefined ? [path] : [path, input]),
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
  // The nudge is content-free; emit an empty message.
  nudge() {
    this.onmessage?.({ data: "" } as MessageEvent);
  }
  error() {
    this.onerror?.(new Event("error"));
  }
  close() {
    this.closed = true;
  }
}
vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

const { useNotificationsRealtime } = await import("./useNotificationsRealtime");

const me: PublicUser = {
  id: "me",
  email: "me@x.io",
  isSuperuser: false,
  roleId: null,
  emailVerified: true,
  permissions: [],
};

const last = () => FakeEventSource.instances[FakeEventSource.instances.length - 1];
const countKeys = () => h.invalidated.filter((k) => k[0] === "unreadCount");
const listKeys = () => h.invalidated.filter((k) => k[0] === "list");

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

describe("useNotificationsRealtime", () => {
  it("opens the per-user stream with credentials", () => {
    renderHook(() => useNotificationsRealtime());
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(last().url).toBe("http://api.test/api/me/notifications/events");
    expect(last().withCredentials).toBe(true);
  });

  it("no-ops when logged out", () => {
    useAuthStore.getState().clearAuth();
    renderHook(() => useNotificationsRealtime());
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("a nudge invalidates count + list (no self-echo skip)", () => {
    renderHook(() => useNotificationsRealtime());
    last().nudge();
    vi.advanceTimersByTime(250);
    expect(countKeys()).toHaveLength(1);
    expect(listKeys()).toHaveLength(1);
  });

  it("debounces a burst into one invalidation per key", () => {
    renderHook(() => useNotificationsRealtime());
    last().nudge();
    last().nudge();
    last().nudge();
    vi.advanceTimersByTime(250);
    expect(countKeys()).toHaveLength(1);
    expect(listKeys()).toHaveLength(1);
  });

  it("does not close on a single transient error; reopen catches up the count", () => {
    renderHook(() => useNotificationsRealtime());
    const es = last();
    es.open(); // first open: no catch-up
    expect(h.invalidated).toHaveLength(0);
    es.error(); // single error: must NOT close
    expect(es.closed).toBe(false);
    es.open(); // reconnect: one count invalidation
    vi.advanceTimersByTime(250);
    expect(countKeys()).toHaveLength(1);
  });

  it("on repeated errors refreshes then reopens (refresh ok)", async () => {
    renderHook(() => useNotificationsRealtime());
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
    renderHook(() => useNotificationsRealtime());
    const es = last();
    es.error();
    es.error();
    await vi.runAllTimersAsync();
    expect(es.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useNotificationsRealtime());
    const es = last();
    unmount();
    expect(es.closed).toBe(true);
  });
});
