import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Project, PublicUser } from "shared";
import { useAuthStore } from "../../../hooks/useAuthStore";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  queryError: {} as Record<string, unknown>,
  mutateCalls: {} as Record<string, unknown[]>,
  mutationResult: {} as Record<string, unknown>,
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
        const r = h.mutationResult[opts._mutationKey];
        opts.onSuccess?.(r, vars);
        runtime?.onSuccess?.(r, vars);
      },
      isPending: false,
      error: null,
    }),
    useQueryClient: () => ({ invalidateQueries: () => {} }),
  };
});

const { ProjectFormPage } = await import("./ProjectFormPage");

const user: PublicUser = {
  id: "u1",
  email: "u@x.io",
  isSuperuser: false,
  roleId: null,
  emailVerified: true,
  permissions: [],
};

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: "p1",
    ownerId: "u1",
    name: "Roadmap",
    description: "Q3",
    color: "#10b981",
    visibility: "private",
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
        <Route path="/projects/new" element={<ProjectFormPage />} />
        <Route path="/projects" element={<div>projects-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.queryData = {};
  h.queryError = {};
  h.mutateCalls = {};
  h.mutationResult = {};
  useAuthStore.getState().setAuth(user);
});

describe("ProjectFormPage (create)", () => {
  it("submits the create input shape with defaults", async () => {
    const u = userEvent.setup();
    h.mutationResult.create = { id: "p9" };
    renderAt("/projects/new");

    await u.type(screen.getByLabelText("Name"), "New board");
    await u.click(screen.getByRole("button", { name: "Create project" }));

    expect(h.mutateCalls.create).toEqual([
      {
        name: "New board",
        description: undefined,
        color: "#4f46e5",
        visibility: "private",
      },
    ]);
  });

  it("navigates to projects after create", async () => {
    const u = userEvent.setup();
    h.mutationResult.create = { id: "p9" };
    renderAt("/projects/new");
    await u.type(screen.getByLabelText("Name"), "New board");
    await u.click(screen.getByRole("button", { name: "Create project" }));
    expect(screen.getByText("projects-page")).toBeInTheDocument();
  });

  it("does not submit when the name is empty", async () => {
    const u = userEvent.setup();
    renderAt("/projects/new");
    await u.click(screen.getByRole("button", { name: "Create project" }));
    expect(h.mutateCalls.create).toBeUndefined();
  });
});
