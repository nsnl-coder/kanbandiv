import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TRPCClientError } from "@trpc/client";
import { BoardError, type ArchivedBoardItems } from "shared";

const h = vi.hoisted(() => ({
  queryData: undefined as ArchivedBoardItems | undefined,
  isLoading: false,
  queryError: null as unknown,
  mutateCalls: {} as Record<string, unknown[]>,
  // per endpoint: an error to feed into the runtime onError of the next mutate
  failWith: {} as Record<string, unknown>,
  invalidated: [] as string[],
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryOptions: (input: unknown) => ({ queryKey: [path, input] }),
    queryKey: (input?: unknown) => [path, input],
    mutationOptions: (opts: Record<string, unknown> = {}) => ({ ...opts, _mutationKey: path }),
  });
  const proxy = new Proxy({}, { get: () => new Proxy({}, { get: (_t, ep: string) => leaf(ep) }) });
  return { useTRPC: () => proxy };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: h.queryData, isLoading: h.isLoading, error: h.queryError }),
  useMutation: (opts: { _mutationKey: string; onSettled?: () => void }) => ({
    mutate: (
      vars: unknown,
      runtime?: { onSuccess?: () => void; onError?: (e: unknown) => void },
    ) => {
      (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
      const err = h.failWith[opts._mutationKey];
      if (err) runtime?.onError?.(err);
      else runtime?.onSuccess?.();
      opts.onSettled?.();
    },
    isPending: false,
    error: null,
  }),
  useQueryClient: () => ({
    invalidateQueries: (arg: { queryKey: [string] }) => h.invalidated.push(arg.queryKey[0]),
  }),
}));

const { ArchivedItemsPanel } = await import("./ArchivedItemsPanel");

function makeItems(over: Partial<ArchivedBoardItems> = {}): ArchivedBoardItems {
  return {
    columns: [
      { id: "c1", boardId: "b1", name: "Old column", position: 0, archivedAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
    ],
    cards: [
      { id: "k1", title: "Old card", columnId: "c2", columnName: "Todo", archivedAt: new Date() },
    ],
    ...over,
  };
}

beforeEach(() => {
  h.queryData = makeItems();
  h.isLoading = false;
  h.queryError = null;
  h.mutateCalls = {};
  h.failWith = {};
  h.invalidated = [];
});

describe("ArchivedItemsPanel", () => {
  it("renders archived columns and cards grouped by column name", () => {
    render(<ArchivedItemsPanel boardId="b1" editable />);
    expect(screen.getByText("Archived columns")).toBeInTheDocument();
    expect(screen.getByText("Old column")).toBeInTheDocument();
    expect(screen.getByText("Archived cards")).toBeInTheDocument();
    expect(screen.getByText("Todo")).toBeInTheDocument();
    expect(screen.getByText("Old card")).toBeInTheDocument();
  });

  it("restores a column via columns.restore and invalidates getData", async () => {
    const u = userEvent.setup();
    render(<ArchivedItemsPanel boardId="b1" editable />);
    const row = screen.getByText("Old column").closest("div")!.parentElement as HTMLElement;
    await u.click(within(row).getByRole("button", { name: "Restore" }));
    expect(h.mutateCalls.restore).toContainEqual({ id: "c1" });
    expect(h.invalidated).toContain("getData");
    expect(h.invalidated).toContain("archivedItems");
  });

  it("restores a card via cards.restore", async () => {
    const u = userEvent.setup();
    render(<ArchivedItemsPanel boardId="b1" editable />);
    const row = screen.getByText("Old card").closest("div")!.parentElement as HTMLElement;
    await u.click(within(row).getByRole("button", { name: "Restore" }));
    expect(h.mutateCalls.restore).toContainEqual({ id: "k1" });
  });

  it("shows PARENT_ARCHIVED message inline on a failed restore", async () => {
    h.failWith = { restore: new TRPCClientError(BoardError.PARENT_ARCHIVED) };
    const u = userEvent.setup();
    render(<ArchivedItemsPanel boardId="b1" editable />);
    const row = screen.getByText("Old card").closest("div")!.parentElement as HTMLElement;
    await u.click(within(row).getByRole("button", { name: "Restore" }));
    expect(screen.getByText("Restore the parent first.")).toBeInTheDocument();
  });

  it("delete permanently confirms then calls columns.delete", async () => {
    const u = userEvent.setup();
    render(<ArchivedItemsPanel boardId="b1" editable />);
    const row = screen.getByText("Old column").closest("div")!.parentElement as HTMLElement;
    await u.click(within(row).getByRole("button", { name: "Delete permanently" }));
    // confirm dialog
    await u.click(
      screen.getByText(/Permanently delete/).closest("div")!.querySelector("button.bg-red-600")!,
    );
    expect(h.mutateCalls.delete).toContainEqual({ id: "c1" });
  });

  it("shows the empty state", () => {
    h.queryData = { columns: [], cards: [] };
    render(<ArchivedItemsPanel boardId="b1" editable />);
    expect(screen.getByText("No archived items.")).toBeInTheDocument();
  });

  it("shows the loading state", () => {
    h.queryData = undefined;
    h.isLoading = true;
    render(<ArchivedItemsPanel boardId="b1" editable />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows the error state", () => {
    h.queryData = undefined;
    h.queryError = new Error("boom");
    render(<ArchivedItemsPanel boardId="b1" editable />);
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("hides controls for non-editors", () => {
    render(<ArchivedItemsPanel boardId="b1" editable={false} />);
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
  });
});
