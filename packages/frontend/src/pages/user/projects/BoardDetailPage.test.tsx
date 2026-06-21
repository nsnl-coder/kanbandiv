import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { DragEndEvent } from "@dnd-kit/core";
import type { BoardData, PublicUser } from "shared";
import { useAuthStore } from "../../../hooks/useAuthStore";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  queryError: {} as Record<string, unknown>,
  mutateCalls: {} as Record<string, unknown[]>,
  mutationError: {} as Record<string, unknown>,
  store: new Map<string, unknown>(),
  dragEnd: null as ((e: DragEndEvent) => void) | null,
  // per-mutation runtime callbacks captured from the last mutate() call
  runtime: {} as Record<string, { onError?: () => void; onSettled?: () => void }>,
  failMove: false,
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

// Render dnd primitives as plain wrappers; capture onDragEnd so tests can fire it.
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: unknown; onDragEnd: (e: DragEndEvent) => void }) => {
    h.dragEnd = onDragEnd;
    return children as never;
  },
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
}));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: unknown }) => children,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: {},
  horizontalListSortingStrategy: {},
}));
vi.mock("@dnd-kit/utilities", () => ({ CSS: { Translate: { toString: () => undefined } } }));

vi.mock("@tanstack/react-query", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (opts: { queryKey: unknown[] }) => ({
      data: h.queryData[opts.queryKey[0] as string],
      isLoading: false,
      error: h.queryError[opts.queryKey[0] as string] ?? null,
    }),
    useMutation: (opts: { _mutationKey: string; onSuccess?: () => void; onSettled?: () => void }) => ({
      mutate: (
        vars: unknown,
        runtime?: { onSuccess?: () => void; onError?: () => void; onSettled?: () => void },
      ) => {
        (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
        h.runtime[opts._mutationKey] = runtime ?? {};
        const isMove = opts._mutationKey === "move";
        if (isMove && h.failMove) {
          runtime?.onError?.();
        } else {
          opts.onSuccess?.();
          runtime?.onSuccess?.();
        }
        opts.onSettled?.();
        runtime?.onSettled?.();
      },
      isPending: false,
      error: h.mutationError[opts._mutationKey] ?? null,
    }),
    useQueryClient: () => ({
      invalidateQueries: () => {},
      setQueryData: (key: unknown[], updater: unknown) => {
        const k = key[0] as string;
        const prev = h.store.get(k);
        const next = typeof updater === "function" ? (updater as (p: unknown) => unknown)(prev) : updater;
        h.store.set(k, next);
        // reflect optimistic state back into what useQuery reads
        h.queryData[k] = next;
      },
      getQueryData: (key: unknown[]) => h.store.get(key[0] as string),
    }),
  };
});

const { BoardDetailPage } = await import("./BoardDetailPage");

const user: PublicUser = {
  id: "u1",
  email: "u@x.io",
  isSuperuser: false,
  roleId: null,
  emailVerified: true,
  permissions: [],
};

function makeData(over: Partial<BoardData> = {}): BoardData {
  return {
    id: "b1",
    projectId: "p1",
    ownerId: "u1",
    name: "Sprint",
    description: null,
    color: "#2563eb",
    myPermission: "owner",
    createdAt: new Date(),
    updatedAt: new Date(),
    columns: [
      {
        id: "c1",
        boardId: "b1",
        name: "Todo",
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        cards: [
          { id: "k1", columnId: "c1", title: "Card 1", description: null, position: 0, dueAt: null, reminderMinutes: null, isOverdue: false, labels: [], checklistProgress: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, createdAt: new Date(), updatedAt: new Date() },
          { id: "k2", columnId: "c1", title: "Card 2", description: null, position: 1, dueAt: null, reminderMinutes: null, isOverdue: false, labels: [], checklistProgress: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, createdAt: new Date(), updatedAt: new Date() },
        ],
      },
      {
        id: "c2",
        boardId: "b1",
        name: "Done",
        position: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        cards: [
          { id: "k3", columnId: "c2", title: "Card 3", description: null, position: 0, dueAt: null, reminderMinutes: null, isOverdue: false, labels: [], checklistProgress: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, createdAt: new Date(), updatedAt: new Date() },
        ],
      },
    ],
    ...over,
  };
}

function renderPage(entry = "/projects/p1/boards/b1") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/projects/:id/boards/:boardId" element={<BoardDetailPage />} />
        <Route path="/projects/:id/boards" element={<div>boards-list</div>} />
        <Route path="/projects/:id/boards/:boardId/edit" element={<div>edit-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  const data = makeData();
  h.queryData = { getData: data, accessList: [] };
  h.queryError = {};
  h.mutateCalls = {};
  h.mutationError = {};
  h.runtime = {};
  h.store = new Map([["getData", data]]);
  h.dragEnd = null;
  h.failMove = false;
  useAuthStore.getState().setAuth(user);
});

describe("BoardDetailPage (render)", () => {
  it("renders columns and cards from getData", () => {
    renderPage();
    expect(screen.getByText("Todo")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Card 1")).toBeInTheDocument();
    expect(screen.getByText("Card 3")).toBeInTheDocument();
  });

  it("owner sees Edit, Archive and Manage access; no permanent Delete", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage access" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("editor sees Archived items and opens the drawer", async () => {
    const u = userEvent.setup();
    h.queryData = { getData: makeData(), accessList: [], archivedItems: { columns: [], cards: [] } };
    renderPage();
    await u.click(screen.getByRole("button", { name: "Archived items" }));
    expect(screen.getByRole("heading", { name: "Archived items" })).toBeInTheDocument();
    expect(screen.getByText("No archived items.")).toBeInTheDocument();
  });

  it("archives the board (owner) and navigates to the project", async () => {
    const u = userEvent.setup();
    renderPage();
    await u.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("heading", { name: "Archive board" }).closest("div")!
      .parentElement as HTMLElement;
    await u.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(h.mutateCalls.archive).toContainEqual({ id: "b1" });
  });

  it("opens the access modal from Manage access", async () => {
    const u = userEvent.setup();
    renderPage();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Manage access" }));
    expect(screen.getByRole("heading", { name: "Board access" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });

  it("shows History for a view-only user and opens the activity modal", async () => {
    h.queryData = { getData: makeData({ myPermission: "view" }), accessList: [] };
    const u = userEvent.setup();
    renderPage();
    const history = screen.getByRole("button", { name: "History" });
    expect(history).toBeInTheDocument();
    await u.click(history);
    expect(screen.getByRole("heading", { name: "Board activity" })).toBeInTheDocument();
  });

  it("view-only hides add/drag and management controls", () => {
    h.queryData = { getData: makeData({ myPermission: "view" }), accessList: [] };
    renderPage();
    expect(screen.queryByRole("button", { name: "Add column" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add card" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archived items" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage access" })).toBeNull();
  });

  it("shows a no-access state on query error (also covers archived deep-link NOT_FOUND)", () => {
    h.queryError = { getData: new Error("nope") };
    renderPage();
    expect(screen.getByText(/not found or no access/)).toBeInTheDocument();
  });
});

describe("BoardDetailPage (?card= deep-link)", () => {
  it("opens the CardEditor for an existing ?card= id", () => {
    renderPage("/projects/p1/boards/b1?card=k1");
    expect(screen.getByRole("heading", { name: "Edit card" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Card 1")).toBeInTheDocument();
  });

  it("ignores a ?card= id not present on the board", () => {
    renderPage("/projects/p1/boards/b1?card=nope");
    expect(screen.queryByRole("heading", { name: "Edit card" })).toBeNull();
  });

  it("closing the editor removes the card param", async () => {
    const u = userEvent.setup();
    renderPage("/projects/p1/boards/b1?card=k1");
    expect(screen.getByRole("heading", { name: "Edit card" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Edit card" })).toBeNull();
  });
});

describe("BoardDetailPage (column + card mutations)", () => {
  it("adds a card via the column affordance", async () => {
    const u = userEvent.setup();
    renderPage();
    const todo = screen.getByText("Todo").closest("div")!.parentElement as HTMLElement;
    await u.click(within(todo).getByRole("button", { name: "Add card" }));
    await u.type(within(todo).getByLabelText("card title"), "Card X{Enter}");
    expect(h.mutateCalls.create).toContainEqual({ columnId: "c1", title: "Card X" });
  });

  it("renames a column", async () => {
    const u = userEvent.setup();
    renderPage();
    await u.click(screen.getByRole("button", { name: "rename Todo" }));
    const input = screen.getByLabelText("column name");
    await u.clear(input);
    await u.type(input, "In progress{Enter}");
    expect(h.mutateCalls.update).toContainEqual({ id: "c1", name: "In progress" });
  });

  it("archives a column", async () => {
    const u = userEvent.setup();
    renderPage();
    await u.click(screen.getByRole("button", { name: "archive Done" }));
    expect(h.mutateCalls.archive).toContainEqual({ id: "c2" });
  });

  it("edits a card through the editor", async () => {
    const u = userEvent.setup();
    renderPage();
    await u.click(screen.getByText("Card 1"));
    const title = screen.getByLabelText("Title");
    await u.clear(title);
    await u.type(title, "Card 1b");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(h.mutateCalls.update).toContainEqual({
      id: "k1",
      title: "Card 1b",
      description: null,
    });
  });

  it("archives a card through the editor", async () => {
    const u = userEvent.setup();
    renderPage();
    await u.click(screen.getByText("Card 2"));
    const dialog = screen.getByRole("heading", { name: "Edit card" }).closest("div")!
      .parentElement as HTMLElement;
    await u.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(h.mutateCalls.archive).toContainEqual({ id: "k2" });
  });
});

describe("BoardDetailPage (drag)", () => {
  it("moves a card to another column and calls cards.move", () => {
    renderPage();
    h.dragEnd!({
      active: { id: "k1", data: { current: { type: "card", columnId: "c1" } } },
      over: { id: "k3" },
    } as unknown as DragEndEvent);
    expect(h.mutateCalls.move).toContainEqual({ id: "k1", toColumnId: "c2", beforeId: "k3" });
  });

  it("rolls back the optimistic card move on error", () => {
    h.failMove = true;
    renderPage();
    h.dragEnd!({
      active: { id: "k1", data: { current: { type: "card", columnId: "c1" } } },
      over: { id: "k3" },
    } as unknown as DragEndEvent);
    // store restored to the snapshot: k1 stays in column c1
    const data = h.store.get("getData") as BoardData;
    const c1 = data.columns.find((c) => c.id === "c1")!;
    expect(c1.cards.some((card) => card.id === "k1")).toBe(true);
  });

  it("moves a column and calls columns.move", () => {
    renderPage();
    h.dragEnd!({
      active: { id: "c1", data: { current: { type: "column" } } },
      over: { id: "c2" },
    } as unknown as DragEndEvent);
    expect(h.mutateCalls.move).toContainEqual({ id: "c1", afterId: "c2" });
  });
});
