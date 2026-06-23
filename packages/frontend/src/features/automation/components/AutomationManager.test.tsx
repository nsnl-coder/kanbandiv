import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
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

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => ({
    data: h.queryData[opts.queryKey[0] as string],
    isLoading: false,
    error: null,
  }),
  useMutation: (opts: { _mutationKey: string; onSettled?: () => void }) => ({
    mutate: (vars: unknown, o?: { onSuccess?: () => void }) => {
      (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
      o?.onSuccess?.();
    },
    isPending: false,
    error: null,
  }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));

const { AutomationManager } = await import("./AutomationManager");

const columns = [{ id: "c1", name: "Done" }];

beforeEach(() => {
  h.queryData = { list: [], runs: [], boardMembers: [] };
  h.mutateCalls = {};
});

describe("AutomationManager", () => {
  it("creates a rule with a no-param action", async () => {
    const u = userEvent.setup();
    render(<AutomationManager boardId="b1" editable columns={columns} />);
    await u.type(screen.getByLabelText("rule name"), "Auto check");
    await u.selectOptions(screen.getByLabelText("action 1 type"), "check_all_items");
    await u.click(screen.getByText("Create rule"));
    expect(h.mutateCalls.create?.[0]).toMatchObject({
      boardId: "b1",
      name: "Auto check",
      trigger: { type: "card.moved", toColumnName: null },
      actions: [{ type: "check_all_items" }],
    });
  });

  it("blocks create when an action is missing its target", async () => {
    const u = userEvent.setup();
    render(<AutomationManager boardId="b1" editable columns={columns} />);
    await u.type(screen.getByLabelText("rule name"), "Needs member");
    // default action is ASSIGN with empty userId -> invalid
    await u.click(screen.getByText("Create rule"));
    expect(h.mutateCalls.create).toBeUndefined();
  });

  it("hides the builder for view-only members", () => {
    render(<AutomationManager boardId="b1" editable={false} columns={columns} />);
    expect(screen.queryByLabelText("rule name")).toBeNull();
  });
});
