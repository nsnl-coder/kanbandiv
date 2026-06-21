import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Notification } from "shared";
import { NotificationType } from "shared";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  queryOpts: {} as Record<string, unknown>,
  mutateCalls: {} as Record<string, unknown[]>,
  invalidated: [] as unknown[][],
  navigate: vi.fn(),
  loading: {} as Record<string, boolean>,
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => {
      h.queryOpts[path] = opts;
      return { queryKey: [path, input], ...opts };
    },
    queryKey: (input?: unknown) => [path, input],
    mutationOptions: (opts: Record<string, unknown> = {}) => ({ ...opts, _mutationKey: path }),
  });
  const proxy = new Proxy({}, { get: () => new Proxy({}, { get: (_t, ep: string) => leaf(ep) }) });
  return { useTRPC: () => proxy };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const key = opts.queryKey[0] as string;
    return { data: h.queryData[key], isLoading: h.loading[key] ?? false, error: null };
  },
  useMutation: (opts: { _mutationKey: string }) => ({
    mutate: (vars: unknown, runtime?: { onSuccess?: () => void }) => {
      (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
      (opts as { onSuccess?: () => void }).onSuccess?.();
      runtime?.onSuccess?.();
    },
    isPending: false,
    error: null,
  }),
  useQueryClient: () => ({
    invalidateQueries: (o: { queryKey: unknown[] }) => h.invalidated.push(o.queryKey),
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => h.navigate,
}));

const { NotificationBell } = await import("./NotificationBell");

function notif(over: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    type: NotificationType.MENTION,
    payload: { boardId: "b1", cardId: "k1", actorHandle: "alice", title: "Task" },
    readAt: null,
    createdAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  h.queryData = {};
  h.queryOpts = {};
  h.mutateCalls = {};
  h.invalidated = [];
  h.loading = {};
  h.navigate = vi.fn();
});

describe("NotificationBell", () => {
  it("shows the unread badge count", () => {
    h.queryData = { unreadCount: { count: 3 } };
    render(<NotificationBell />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders no badge when count is 0", () => {
    h.queryData = { unreadCount: { count: 0 } };
    render(<NotificationBell />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("caps the badge at 99+", () => {
    h.queryData = { unreadCount: { count: 150 } };
    render(<NotificationBell />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("configures unreadCount with refetchOnWindowFocus (fallback path)", () => {
    h.queryData = { unreadCount: { count: 0 } };
    render(<NotificationBell />);
    expect(h.queryOpts.unreadCount).toMatchObject({
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
    });
  });

  it("opening lists notifications via NotificationItem", async () => {
    h.queryData = {
      unreadCount: { count: 1 },
      list: { items: [notif()], nextOffset: null },
    };
    const u = userEvent.setup();
    render(<NotificationBell />);
    await u.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByText('alice mentioned you on "Task"')).toBeInTheDocument();
  });

  it("renders a line per notification type", async () => {
    h.queryData = {
      unreadCount: { count: 3 },
      list: {
        items: [
          notif({ id: "a", type: NotificationType.MENTION }),
          notif({ id: "b", type: NotificationType.CARD_ASSIGNED }),
          notif({
            id: "c",
            type: NotificationType.CARD_DUE_SOON,
            payload: { boardId: "b1", cardId: "k1", actorHandle: null, title: "Task" },
          }),
        ],
        nextOffset: null,
      },
    };
    const u = userEvent.setup();
    render(<NotificationBell />);
    await u.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByText('alice mentioned you on "Task"')).toBeInTheDocument();
    expect(screen.getByText('alice assigned you to "Task"')).toBeInTheDocument();
    expect(screen.getByText('"Task" is due soon')).toBeInTheDocument();
  });

  it("shows the empty state when there are no items", async () => {
    h.queryData = { unreadCount: { count: 0 }, list: { items: [], nextOffset: null } };
    const u = userEvent.setup();
    render(<NotificationBell />);
    await u.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
  });

  it("shows a loading state", async () => {
    h.queryData = { unreadCount: { count: 0 } };
    h.loading = { list: true };
    const u = userEvent.setup();
    render(<NotificationBell />);
    await u.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("clicking a row marks it read and navigates with ?card=", async () => {
    h.queryData = {
      unreadCount: { count: 1 },
      list: { items: [notif()], nextOffset: null },
    };
    const u = userEvent.setup();
    render(<NotificationBell />);
    await u.click(screen.getByRole("button", { name: /Notifications/ }));
    await u.click(screen.getByText('alice mentioned you on "Task"'));
    expect(h.mutateCalls.markRead).toContainEqual({ id: "n1" });
    expect(h.navigate).toHaveBeenCalledWith("/boards/b1?card=k1");
  });

  it("a row without a cardId navigates without ?card=", async () => {
    h.queryData = {
      unreadCount: { count: 1 },
      list: {
        items: [
          notif({
            payload: { boardId: "b1", actorHandle: null, title: "Task" },
            type: NotificationType.CARD_DUE_SOON,
          }),
        ],
        nextOffset: null,
      },
    };
    const u = userEvent.setup();
    render(<NotificationBell />);
    await u.click(screen.getByRole("button", { name: /Notifications/ }));
    await u.click(screen.getByText('"Task" is due soon'));
    expect(h.navigate).toHaveBeenCalledWith("/boards/b1");
  });

  it("mark all read calls the mutation and invalidates; disabled at count 0", async () => {
    h.queryData = {
      unreadCount: { count: 2 },
      list: { items: [notif()], nextOffset: null },
    };
    const u = userEvent.setup();
    render(<NotificationBell />);
    await u.click(screen.getByRole("button", { name: /Notifications/ }));
    await u.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(h.mutateCalls.markAllRead).toHaveLength(1);
    expect(h.invalidated.some((k) => k[0] === "unreadCount")).toBe(true);
    expect(h.invalidated.some((k) => k[0] === "list")).toBe(true);
  });

  it("disables Mark all read when count is 0", async () => {
    h.queryData = { unreadCount: { count: 0 }, list: { items: [], nextOffset: null } };
    const u = userEvent.setup();
    render(<NotificationBell />);
    await u.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  });
});
