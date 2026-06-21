import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityType, type Activity } from "shared";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  isLoading: false,
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryOptions: (input: unknown) => ({ queryKey: [path, input] }),
    queryKey: (input?: unknown) => [path, input],
  });
  const proxy = new Proxy({}, { get: () => new Proxy({}, { get: (_t, ep: string) => leaf(ep) }) });
  return { useTRPC: () => proxy };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => ({
    data: h.queryData[opts.queryKey[0] as string],
    isLoading: h.isLoading,
    error: null,
  }),
}));

const { CardActivity } = await import("./CardActivity");

function act(over: Partial<Activity> = {}): Activity {
  return {
    id: "a1",
    boardId: "b1",
    cardId: "k1",
    type: ActivityType.CARD_RENAMED,
    meta: { from: "Old", to: "New" },
    actor: { id: "u1", handle: "alice" },
    createdAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  h.queryData = {};
  h.isLoading = false;
});

describe("CardActivity", () => {
  it("renders a line per returned activity", () => {
    h.queryData = { listForCard: [act(), act({ id: "a2", meta: { from: "X", to: "Y" } })] };
    render(<CardActivity cardId="k1" />);
    expect(screen.getByText(/renamed from "Old" to "New"/)).toBeInTheDocument();
    expect(screen.getByText(/renamed from "X" to "Y"/)).toBeInTheDocument();
  });

  it("shows the empty state when there is no activity", () => {
    h.queryData = { listForCard: [] };
    render(<CardActivity cardId="k1" />);
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });

  it("shows the loading state", () => {
    h.isLoading = true;
    render(<CardActivity cardId="k1" />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});
