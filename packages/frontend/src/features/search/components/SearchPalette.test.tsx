import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SearchResult } from "shared";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  lastSearchInput: null as Record<string, unknown> | null,
  searchEnabled: false,
  navigate: vi.fn(),
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryOptions: (input: unknown, opts?: { enabled?: boolean }) => {
      if (path === "cards") {
        h.lastSearchInput = input as Record<string, unknown>;
        h.searchEnabled = opts?.enabled ?? true;
      }
      return { queryKey: [path, input], _enabled: opts?.enabled ?? true };
    },
    queryKey: (input?: unknown) => [path, input],
  });
  const proxy = new Proxy({}, { get: () => new Proxy({}, { get: (_t, ep: string) => leaf(ep) }) });
  return { useTRPC: () => proxy };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[]; _enabled?: boolean }) => ({
    data: opts._enabled === false ? undefined : h.queryData[opts.queryKey[0] as string],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => h.navigate };
});

const { SearchPalette } = await import("./SearchPalette");
const { useSearchStore } = await import("../../../hooks/useSearchStore");

function result(over: Partial<SearchResult> = {}): SearchResult {
  return {
    cardId: "k1",
    title: "Fix login bug",
    snippet: "the login bug appears on submit",
    boardId: "b1",
    boardName: "Sprint",
    columnId: "c1",
    columnName: "Todo",
    projectId: "p1",
    dueAt: null,
    isOverdue: false,
    ...over,
  };
}

function renderPalette() {
  return render(
    <MemoryRouter>
      <SearchPalette />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.queryData = { list: [] };
  h.lastSearchInput = null;
  h.navigate = vi.fn();
  useSearchStore.getState().setOpen(true);
});

describe("SearchPalette", () => {
  it("renders and autofocuses the input when open", () => {
    renderPalette();
    const input = screen.getByLabelText("search input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("renders nothing when the store is closed", () => {
    useSearchStore.getState().setOpen(false);
    const { container } = renderPalette();
    expect(container.firstChild).toBeNull();
  });

  it("shows the hint and does not enable the query for an empty query", () => {
    renderPalette();
    expect(screen.getByText("Type to search")).toBeInTheDocument();
    expect(h.searchEnabled).toBe(false);
  });

  it("debounces typing into the search.cards query input", () => {
    vi.useFakeTimers();
    h.queryData = { cards: { items: [], nextOffset: null }, list: [] };
    renderPalette();
    fireEvent.change(screen.getByLabelText("search input"), { target: { value: "login" } });
    // Before the debounce elapses the query still carries the old (empty) q.
    expect(h.lastSearchInput).toMatchObject({ q: "" });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(h.lastSearchInput).toMatchObject({ q: "login", limit: 20, offset: 0 });
    expect(h.searchEnabled).toBe(true);
    vi.useRealTimers();
  });

  it("renders result rows with title, breadcrumb, snippet and due badge", () => {
    h.queryData = {
      cards: {
        items: [result({ dueAt: new Date(Date.now() - 1000), isOverdue: true })],
        nextOffset: null,
      },
      list: [],
    };
    renderPalette();
    fireEvent.click(screen.getByLabelText("filter Overdue"));
    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    expect(screen.getByText(/Sprint.*Todo/)).toBeInTheDocument();
    expect(screen.getByText("the login bug appears on submit")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Due/)).toBeInTheDocument();
  });

  it("shows results, navigates with ?card= and closes on click", () => {
    h.queryData = { cards: { items: [result()], nextOffset: null }, list: [] };
    renderPalette();
    fireEvent.click(screen.getByLabelText("filter Overdue"));
    expect(h.lastSearchInput).toMatchObject({ due: "overdue" });

    fireEvent.click(screen.getByText("Fix login bug"));
    expect(h.navigate).toHaveBeenCalledWith("/projects/p1/boards/b1?card=k1");
    expect(useSearchStore.getState().open).toBe(false);
  });

  it("shows 'No cards found' for an enabled query with no results", () => {
    h.queryData = { cards: { items: [], nextOffset: null }, list: [] };
    renderPalette();
    fireEvent.click(screen.getByLabelText("filter Overdue"));
    expect(screen.getByText("No cards found")).toBeInTheDocument();
  });

  it("Load more appears only when nextOffset is set and requests the next page", () => {
    h.queryData = { cards: { items: [result()], nextOffset: 20 }, list: [] };
    renderPalette();
    fireEvent.click(screen.getByLabelText("filter Overdue"));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(h.lastSearchInput).toMatchObject({ offset: 20 });
  });

  it("selecting a project scope sends projectId", () => {
    h.queryData = {
      cards: { items: [], nextOffset: null },
      list: [{ id: "p9", name: "Marketing", color: "#000" }],
    };
    renderPalette();
    fireEvent.click(screen.getByLabelText("filter Overdue"));
    fireEvent.change(screen.getByLabelText("project scope"), { target: { value: "p9" } });
    expect(h.lastSearchInput).toMatchObject({ projectId: "p9" });
  });
});
