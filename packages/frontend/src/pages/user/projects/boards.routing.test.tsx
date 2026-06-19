import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "../../../components/ProtectedRoute";
import { useAuthStore } from "../../../hooks/useAuthStore";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  queryError: {} as Record<string, unknown>,
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

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: unknown }) => children,
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
}));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: unknown }) => children,
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, transition: undefined, isDragging: false }),
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
    useMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
    useQueryClient: () => ({ invalidateQueries: () => {}, setQueryData: () => {}, getQueryData: () => undefined }),
  };
});

const { BoardFormPage } = await import("./BoardFormPage");
const { BoardDetailPage } = await import("./BoardDetailPage");

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/projects/:id/boards/:boardId" element={<BoardDetailPage />} />
          <Route path="/projects/:id/boards/:boardId/edit" element={<BoardFormPage />} />
        </Route>
        <Route path="/login" element={<div>login-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.queryData = {};
  h.queryError = {};
  useAuthStore.getState().setAuth({
    id: "u1",
    email: "u@x.io",
    isSuperuser: false,
    roleId: null,
    emailVerified: true,
    permissions: [],
  });
});

describe("boards routes", () => {
  it("renders the board detail page", () => {
    h.queryData = {
      getData: {
        id: "b1",
        projectId: "p1",
        ownerId: "u1",
        name: "Sprint",
        description: null,
        color: "#2563eb",
        myPermission: "owner",
        createdAt: new Date(),
        updatedAt: new Date(),
        columns: [],
      },
      accessList: [],
    };
    renderAt("/projects/p1/boards/b1");
    expect(screen.getByRole("heading", { name: "Sprint" })).toBeInTheDocument();
  });

  it("renders the edit form", () => {
    h.queryData = {
      get: {
        id: "b1",
        projectId: "p1",
        ownerId: "u1",
        name: "Sprint",
        description: null,
        color: "#2563eb",
        myPermission: "owner",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    renderAt("/projects/p1/boards/b1/edit");
    expect(screen.getByRole("heading", { name: "Edit board" })).toBeInTheDocument();
  });

  it("surfaces NOT_FOUND for an unknown board", () => {
    h.queryError = { getData: new Error("nope") };
    renderAt("/projects/p1/boards/zzz");
    expect(screen.getByText(/not found or no access/)).toBeInTheDocument();
  });

  it("redirects an unauthenticated user to login", () => {
    useAuthStore.getState().clearAuth();
    renderAt("/projects/p1/boards/b1");
    expect(screen.getByText("login-page")).toBeInTheDocument();
  });
});
