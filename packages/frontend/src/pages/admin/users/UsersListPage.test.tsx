import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminUser, PublicUser } from "shared";
import { useAuthStore } from "../../../hooks/useAuthStore";

const h = vi.hoisted(() => ({
  mutateCalls: [] as unknown[],
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
  return { useTRPC: () => ({ admin: ns }) };
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
    useMutation: (opts: { onSuccess?: () => void }) => ({
      mutate: (vars: unknown) => {
        h.mutateCalls.push(vars);
        opts.onSuccess?.();
      },
      isPending: false,
      error: null,
    }),
    useQueryClient: () => ({ invalidateQueries: () => {} }),
  };
});

const { UsersListPage } = await import("./UsersListPage");

const superuser: PublicUser = {
  id: "su",
  email: "su@x.io",
  isSuperuser: true,
  roleId: null,
  emailVerified: true,
  permissions: [],
};

const users: AdminUser[] = [
  { id: "u1", email: "a@x.io", emailVerified: true, isSuperuser: false, role: null },
  {
    id: "u2",
    email: "b@x.io",
    emailVerified: true,
    isSuperuser: false,
    role: { id: "r1", name: "Admin" },
  },
];

beforeEach(() => {
  h.mutateCalls = [];
  h.queryData = { usersList: users, rolesList: [{ id: "r1", name: "Admin" }] };
  useAuthStore.getState().setAuth(superuser);
});

describe("UsersListPage", () => {
  it("assigns a role with the selected roleId", async () => {
    const user = userEvent.setup();
    render(<UsersListPage />);
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "r1");
    expect(h.mutateCalls).toContainEqual({ userId: "u1", roleId: "r1" });
  });

  it("clears a role by assigning null when 'No role' is chosen", async () => {
    const user = userEvent.setup();
    render(<UsersListPage />);
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "");
    expect(h.mutateCalls).toContainEqual({ userId: "u2", roleId: null });
  });

  it("wires the search input value", async () => {
    const user = userEvent.setup();
    render(<UsersListPage />);
    const input = screen.getByPlaceholderText("Search by email...");
    await user.type(input, "alice");
    expect(input).toHaveValue("alice");
  });
});
