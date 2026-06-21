import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Assignee } from "shared";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  mutateCalls: {} as Record<string, unknown[]>,
  mutateError: {} as Record<string, boolean>,
  store: new Map<string, unknown>(),
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
  useQuery: (opts: { queryKey: unknown[] }) => ({
    data: h.queryData[opts.queryKey[0] as string],
    isLoading: false,
    error: null,
  }),
  useMutation: (opts: { _mutationKey: string }) => ({
    mutate: (
      vars: unknown,
      runtime?: { onSuccess?: (d: unknown) => void; onError?: () => void },
    ) => {
      (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
      if (h.mutateError[opts._mutationKey]) runtime?.onError?.();
      else runtime?.onSuccess?.([]);
    },
    isPending: false,
    error: null,
  }),
  useQueryClient: () => ({
    invalidateQueries: () => {},
    setQueryData: (key: unknown[], updater: unknown) => {
      const k = key[0] as string;
      const prev = h.store.get(k);
      const next = typeof updater === "function" ? (updater as (p: unknown) => unknown)(prev) : updater;
      h.store.set(k, next);
    },
    getQueryData: (key: unknown[]) => h.store.get(key[0] as string),
  }),
}));

const { AssigneePicker } = await import("./AssigneePicker");

const alice: Assignee = { id: "u1", email: "alice@example.com" };
const bob: Assignee = { id: "u2", email: "bob@example.com" };

beforeEach(() => {
  h.queryData = { boardMembers: [alice, bob] };
  h.mutateCalls = {};
  h.mutateError = {};
  h.store = new Map([["getData", { columns: [{ cards: [{ id: "k1", assignees: [alice] }] }] }]]);
});

describe("AssigneePicker", () => {
  it("assigns an unassigned member", async () => {
    const u = userEvent.setup();
    render(<AssigneePicker boardId="b1" cardId="k1" assignees={[alice]} editable />);
    await u.click(screen.getByLabelText("toggle assignee bob"));
    expect(h.mutateCalls.assign).toContainEqual({ cardId: "k1", userId: "u2" });
  });

  it("unassigns an assigned member", async () => {
    const u = userEvent.setup();
    render(<AssigneePicker boardId="b1" cardId="k1" assignees={[alice]} editable />);
    await u.click(screen.getByLabelText("toggle assignee alice"));
    expect(h.mutateCalls.unassign).toContainEqual({ cardId: "k1", userId: "u1" });
  });

  it("hides toggles for view-only", () => {
    render(<AssigneePicker boardId="b1" cardId="k1" assignees={[alice]} editable={false} />);
    expect(screen.queryByLabelText("toggle assignee bob")).toBeNull();
  });

  it("rolls back the optimistic update on server error", async () => {
    const u = userEvent.setup();
    h.mutateError = { assign: true };
    render(<AssigneePicker boardId="b1" cardId="k1" assignees={[alice]} editable />);
    await u.click(screen.getByLabelText("toggle assignee bob"));
    const data = h.store.get("getData") as { columns: { cards: { assignees: Assignee[] }[] }[] };
    const cardAssignees = data.columns[0].cards[0].assignees;
    expect(cardAssignees.map((a) => a.id)).toEqual(["u1"]);
  });
});
