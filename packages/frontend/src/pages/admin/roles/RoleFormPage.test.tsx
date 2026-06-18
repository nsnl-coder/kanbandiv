import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TRPCClientError } from "@trpc/client";
import { Permission, RbacError, type PublicUser } from "shared";
import { useAuthStore } from "../../../hooks/useAuthStore";

const h = vi.hoisted(() => ({
  mutateCalls: {} as Record<string, unknown[]>,
  mutationError: {} as Record<string, unknown>,
  queryData: {} as Record<string, unknown>,
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryOptions: (input: unknown) => ({ queryKey: [path, input] }),
    queryKey: (input?: unknown) => [path, input],
    mutationOptions: (opts: Record<string, unknown> = {}) => ({
      ...opts,
      _mutationKey: path,
    }),
  });
  const ns = new Proxy({}, { get: (_t, ep: string) => leaf(ep) });
  const trpc = { admin: ns };
  return { useTRPC: () => trpc };
});

vi.mock("@tanstack/react-query", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (opts: { queryKey: unknown[] }) => ({
      data: h.queryData[opts.queryKey[0] as string],
      isLoading: false,
      error: null,
    }),
    useMutation: (opts: { _mutationKey: string; onSuccess?: () => void }) => ({
      mutate: (vars: unknown) => {
        (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
        opts.onSuccess?.();
      },
      isPending: false,
      error: h.mutationError[opts._mutationKey] ?? null,
    }),
    useQueryClient: () => ({ invalidateQueries: () => {} }),
  };
});

const { RoleFormPage } = await import("./RoleFormPage");

function renderNew() {
  return render(
    <MemoryRouter initialEntries={["/admin/roles/new"]}>
      <Routes>
        <Route path="/admin/roles/new" element={<RoleFormPage />} />
        <Route path="/admin/roles" element={<div>roles-list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const superuser: PublicUser = {
  id: "su",
  email: "su@x.io",
  isSuperuser: true,
  roleId: null,
  emailVerified: true,
  permissions: [],
};

beforeEach(() => {
  h.mutateCalls = {};
  h.mutationError = {};
  h.queryData = {};
  useAuthStore.getState().setAuth(superuser);
});

describe("RoleFormPage (create)", () => {
  it("maps catalog toggles to permissions[] on create", async () => {
    const user = userEvent.setup();
    renderNew();

    await user.type(screen.getByLabelText("Name"), "Support");
    await user.click(screen.getByLabelText(/Read roles/));
    await user.click(screen.getByRole("button", { name: "Create role" }));

    expect(h.mutateCalls.rolesCreate).toEqual([
      {
        name: "Support",
        description: undefined,
        permissions: [Permission.AdminRolesRead],
      },
    ]);
  });

  it("surfaces a ROLE_NAME_TAKEN error by message", () => {
    h.mutationError.rolesCreate = new TRPCClientError(RbacError.ROLE_NAME_TAKEN);
    renderNew();
    expect(
      screen.getByText("A role with that name already exists."),
    ).toBeInTheDocument();
  });
});
