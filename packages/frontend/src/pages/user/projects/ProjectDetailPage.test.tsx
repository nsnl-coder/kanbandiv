import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Board, Project, PublicUser } from "shared";
import { useAuthStore } from "../../../hooks/useAuthStore";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  queryError: {} as Record<string, unknown>,
  mutateCalls: {} as Record<string, unknown[]>,
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
    useMutation: (opts: { _mutationKey: string; onSuccess?: () => void }) => ({
      mutate: (vars: unknown) => {
        (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
        opts.onSuccess?.();
      },
      isPending: false,
      error: null,
    }),
    useQueryClient: () => ({ invalidateQueries: () => {} }),
  };
});

const { ProjectDetailPage } = await import("./ProjectDetailPage");

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

function makeBoard(over: Partial<Board> = {}): Board {
  return {
    id: "ab1",
    projectId: "p1",
    ownerId: "u1",
    name: "Archived board",
    description: null,
    color: "#2563eb",
    myPermission: "owner",
    archivedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/p1"]}>
      <Routes>
        <Route path="/projects/p1" element={<ProjectDetailPage />} />
        <Route path="/projects" element={<div>projects-list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.queryData = { accessList: [] };
  h.queryError = {};
  h.mutateCalls = {};
  useAuthStore.getState().setAuth(user);
});

describe("ProjectDetailPage", () => {
  it("shows Project settings and Manage access for the owner", () => {
    h.queryData = { get: makeProject(), accessList: [] };
    renderPage();
    expect(screen.getByRole("button", { name: "Project settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage access" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("opens the access modal from Manage access", async () => {
    const u = userEvent.setup();
    h.queryData = { get: makeProject(), accessList: [] };
    renderPage();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Manage access" }));
    expect(screen.getByRole("heading", { name: "Project access" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });

  it("opens the edit modal from Project settings", async () => {
    const u = userEvent.setup();
    h.queryData = { get: makeProject(), accessList: [] };
    renderPage();
    expect(screen.queryByRole("heading", { name: "Edit project" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Project settings" }));
    expect(screen.getByRole("heading", { name: "Edit project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("shows Project settings but no Manage access for an editor", () => {
    h.queryData = { get: makeProject({ ownerId: "u2", myPermission: "edit" }), accessList: [] };
    renderPage();
    expect(screen.getByRole("button", { name: "Project settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage access" })).toBeNull();
  });

  it("hides Project settings for a viewer", () => {
    h.queryData = { get: makeProject({ ownerId: "u2", myPermission: "view" }), accessList: [] };
    renderPage();
    expect(screen.queryByRole("button", { name: "Project settings" })).toBeNull();
  });

  it("shows a no-access state on query error", () => {
    h.queryError = { get: new Error("nope") };
    renderPage();
    expect(screen.getByText(/not found or no access/)).toBeInTheDocument();
  });
});

describe("ProjectDetailPage archived boards", () => {
  it("renders the archived-boards section and expands it", async () => {
    const u = userEvent.setup();
    h.queryData = { get: makeProject(), accessList: [], list: [], archived: [makeBoard()] };
    renderPage();
    const toggle = screen.getByRole("button", { name: /Archived boards/ });
    expect(toggle).toBeInTheDocument();
    await u.click(toggle);
    expect(screen.getByText("Archived board")).toBeInTheDocument();
  });

  it("hides the section entirely when there are no archived boards", () => {
    h.queryData = { get: makeProject(), accessList: [], list: [], archived: [] };
    renderPage();
    expect(screen.queryByRole("button", { name: /Archived boards/ })).toBeNull();
  });

  it("owner can restore and permanently delete an archived board", async () => {
    const u = userEvent.setup();
    h.queryData = { get: makeProject(), accessList: [], list: [], archived: [makeBoard()] };
    renderPage();
    await u.click(screen.getByRole("button", { name: /Archived boards/ }));
    await u.click(screen.getByRole("button", { name: "Restore" }));
    expect(h.mutateCalls.restore).toContainEqual({ id: "ab1" });

    await u.click(screen.getByRole("button", { name: "Delete permanently" }));
    const confirm = screen.getByText(/Permanently delete/).closest("div") as HTMLElement;
    await u.click(confirm.querySelector("button.bg-red-600")!);
    expect(h.mutateCalls.delete).toContainEqual({ id: "ab1" });
  });

  it("non-owner sees neither restore nor delete", async () => {
    const u = userEvent.setup();
    h.queryData = {
      get: makeProject({ ownerId: "u2", myPermission: "edit" }),
      accessList: [],
      list: [],
      archived: [makeBoard({ ownerId: "u2", myPermission: "edit" })],
    };
    renderPage();
    await u.click(screen.getByRole("button", { name: /Archived boards/ }));
    expect(screen.getByText("Archived board")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
  });
});
