import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityType, type Activity, type BoardActivityPage } from "shared";

const h = vi.hoisted(() => ({
  // page keyed by offset
  pages: {} as Record<number, BoardActivityPage>,
  requestedOffsets: [] as number[],
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
  useQuery: (opts: { queryKey: [string, { offset: number }] }) => {
    const offset = opts.queryKey[1].offset;
    h.requestedOffsets.push(offset);
    return { data: h.pages[offset], isLoading: false, error: null };
  },
}));

const { BoardActivityPanel } = await import("./BoardActivityPanel");

function act(id: string, snippet: string): Activity {
  return {
    id,
    boardId: "b1",
    cardId: null,
    type: ActivityType.COMMENT_ADDED,
    meta: { snippet, cardTitle: "Card" },
    actor: { id: "u1", handle: "alice" },
    createdAt: new Date(),
  };
}

beforeEach(() => {
  h.pages = {};
  h.requestedOffsets = [];
});

describe("BoardActivityPanel", () => {
  it("hides Load more when nextOffset is null", () => {
    h.pages = { 0: { items: [act("a1", "first")], nextOffset: null } };
    render(<BoardActivityPanel boardId="b1" />);
    expect(screen.getByText(/first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows Load more when nextOffset is non-null and appends the next page", async () => {
    h.pages = {
      0: { items: [act("a1", "first")], nextOffset: 50 },
      50: { items: [act("a2", "second")], nextOffset: null },
    };
    const u = userEvent.setup();
    render(<BoardActivityPanel boardId="b1" />);
    expect(screen.getByText(/first/)).toBeInTheDocument();
    const more = screen.getByRole("button", { name: "Load more" });
    await u.click(more);
    expect(h.requestedOffsets).toContain(50);
    expect(screen.getByText(/first/)).toBeInTheDocument();
    expect(screen.getByText(/second/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows the empty state when there is no activity", () => {
    h.pages = { 0: { items: [], nextOffset: null } };
    render(<BoardActivityPanel boardId="b1" />);
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });
});
