import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TRPCClientError } from "@trpc/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BoardError, type Board, type PublicUser } from "shared";
import { useAuthStore } from "../../../hooks/useAuthStore";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  queryError: {} as Record<string, unknown>,
  mutateCalls: {} as Record<string, unknown[]>,
  mutationResult: {} as Record<string, unknown>,
  mutationError: {} as Record<string, unknown>,
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

vi.mock("@tanstack/react-query", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (opts: { queryKey: unknown[] }) => ({
      data: h.queryData[opts.queryKey[0] as string],
      isLoading: false,
      error: h.queryError[opts.queryKey[0] as string] ?? null,
    }),
    useMutation: (opts: { _mutationKey: string; onSuccess?: (r: unknown, v: unknown) => void }) => ({
      mutate: (vars: unknown, runtime?: { onSuccess?: (r: unknown, v: unknown) => void }) => {
        (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
        if (h.mutationError[opts._mutationKey]) return;
        const r = h.mutationResult[opts._mutationKey];
        opts.onSuccess?.(r, vars);
        runtime?.onSuccess?.(r, vars);
      },
      isPending: false,
      error: h.mutationError[opts._mutationKey] ?? null,
    }),
    useQueryClient: () => ({ invalidateQueries: () => {} }),
  };
});

const { BoardFormPage } = await import("./BoardFormPage");

const user: PublicUser = {
  id: "u1",
  email: "u@x.io",
  isSuperuser: false,
  roleId: null,
  emailVerified: true,
  permissions: [],
};

function makeBoard(over: Partial<Board> = {}): Board {
  return {
    id: "b1",
    projectId: "p1",
    ownerId: "u1",
    name: "Sprint",
    description: "Q3",
    color: "#2563eb",
    myPermission: "owner",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:id/boards/:boardId/edit" element={<BoardFormPage />} />
        <Route path="/projects/:id/boards/:boardId" element={<div>detail-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.queryData = {};
  h.queryError = {};
  h.mutateCalls = {};
  h.mutationResult = {};
  h.mutationError = {};
  useAuthStore.getState().setAuth(user);
});

describe("BoardFormPage (edit)", () => {
  it("renders the mapped error message", async () => {
    const u = userEvent.setup();
    h.queryData = { get: makeBoard() };
    h.mutationError.update = new TRPCClientError(BoardError.FORBIDDEN);
    renderAt("/projects/p1/boards/b1/edit");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("You do not have permission to do that.")).toBeInTheDocument();
  });

  it("prefills from the loaded board", () => {
    h.queryData = { get: makeBoard() };
    renderAt("/projects/p1/boards/b1/edit");
    expect(screen.getByLabelText("Name")).toHaveValue("Sprint");
  });

  it("disables fields for a viewer", () => {
    h.queryData = { get: makeBoard({ myPermission: "view" }) };
    renderAt("/projects/p1/boards/b1/edit");
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("submits an update patch on save", async () => {
    const u = userEvent.setup();
    h.queryData = { get: makeBoard() };
    renderAt("/projects/p1/boards/b1/edit");
    const name = screen.getByLabelText("Name");
    await u.clear(name);
    await u.type(name, "Renamed");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(h.mutateCalls.update).toEqual([
      {
        id: "b1",
        name: "Renamed",
        description: "Q3",
        color: "#2563eb",
      },
    ]);
  });

  it("shows a no-access state on query error", () => {
    h.queryError = { get: new Error("nope") };
    renderAt("/projects/p1/boards/b1/edit");
    expect(screen.getByText(/not found or no access/)).toBeInTheDocument();
  });
});
