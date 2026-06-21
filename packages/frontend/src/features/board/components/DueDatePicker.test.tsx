import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import type { Card } from "shared";

const h = vi.hoisted(() => ({
  mutateCalls: {} as Record<string, unknown[]>,
  store: new Map<string, unknown>(),
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryKey: (input?: unknown) => [path, input],
    mutationOptions: (opts: Record<string, unknown> = {}) => ({ ...opts, _mutationKey: path }),
  });
  const proxy = new Proxy({}, { get: () => new Proxy({}, { get: (_t, ep: string) => leaf(ep) }) });
  return { useTRPC: () => proxy };
});

vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: { _mutationKey: string }) => ({
    mutate: (vars: unknown) => {
      (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
    },
    isPending: false,
    error: null,
  }),
  useQueryClient: () => ({
    setQueryData: (key: unknown[], updater: unknown) => {
      const k = key[0] as string;
      const prev = h.store.get(k);
      const next = typeof updater === "function" ? (updater as (p: unknown) => unknown)(prev) : updater;
      h.store.set(k, next);
    },
    getQueryData: (key: unknown[]) => h.store.get(key[0] as string),
  }),
}));

const { DueDatePicker } = await import("./DueDatePicker");

function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "k1",
    columnId: "c1",
    title: "Card",
    description: null,
    position: 0,
    dueAt: null,
    reminderMinutes: null,
    isOverdue: false,
    labels: [],
    checklistProgress: { done: 0, total: 0 },
    commentCount: 0,
    attachmentCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  h.mutateCalls = {};
  h.store = new Map([["getData", { columns: [{ cards: [makeCard()] }] }]]);
});

describe("DueDatePicker", () => {
  it("setting a date calls cards.update with a dueAt Date", () => {
    render(<DueDatePicker boardId="b1" card={makeCard()} editable />);
    fireEvent.change(screen.getByLabelText("due date"), { target: { value: "2030-01-02T10:30" } });
    const call = h.mutateCalls.update?.[0] as { id: string; dueAt: Date };
    expect(call.id).toBe("k1");
    expect(call.dueAt).toBeInstanceOf(Date);
  });

  it("reminder select passes reminderMinutes", () => {
    render(
      <DueDatePicker boardId="b1" card={makeCard({ dueAt: new Date() })} editable />,
    );
    fireEvent.change(screen.getByLabelText("reminder"), { target: { value: "60" } });
    expect(h.mutateCalls.update).toContainEqual({ id: "k1", reminderMinutes: 60 });
  });

  it("clear sends null dueAt", async () => {
    const u = userEvent.setup();
    render(
      <DueDatePicker boardId="b1" card={makeCard({ dueAt: new Date() })} editable />,
    );
    await u.click(screen.getByLabelText("clear due date"));
    expect(h.mutateCalls.update).toContainEqual({ id: "k1", dueAt: null, reminderMinutes: null });
  });

  it("disables inputs for view-only", () => {
    render(<DueDatePicker boardId="b1" card={makeCard({ dueAt: new Date() })} editable={false} />);
    expect(screen.getByLabelText("due date")).toBeDisabled();
    expect(screen.getByLabelText("reminder")).toBeDisabled();
  });
});
