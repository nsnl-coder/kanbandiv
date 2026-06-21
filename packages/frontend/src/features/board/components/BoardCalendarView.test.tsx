import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Card } from "shared";
import type { CardFilter } from "../utils";

const h = vi.hoisted(() => ({
  data: undefined as Card[] | undefined,
  isLoading: false,
  lastInput: undefined as unknown,
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = () => ({ queryOptions: (input: unknown) => ({ queryKey: ["due", input], input }) });
  const proxy = new Proxy({}, { get: () => new Proxy({}, { get: () => leaf() }) });
  return { useTRPC: () => proxy };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { input: unknown }) => {
    h.lastInput = opts.input;
    return { data: h.data, isLoading: h.isLoading, error: null };
  },
}));

const { BoardCalendarView } = await import("./BoardCalendarView");

const card = (id: string, dueAt: Date | null, over: Partial<Card> = {}): Card => ({
  id,
  columnId: "c1",
  title: id,
  description: null,
  position: 0,
  dueAt,
  reminderMinutes: null,
  isOverdue: false,
  cover: null,
  labels: [],
  assignees: [],
  checklistProgress: { done: 0, total: 0 },
  commentCount: 0,
  attachmentCount: 0,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const filter: CardFilter = {
  labelIds: [],
  assigneeIds: [],
  assignedToMe: false,
  due: null,
  currentUserId: "me",
};

beforeEach(() => {
  h.data = undefined;
  h.isLoading = false;
});

describe("BoardCalendarView", () => {
  it("places a card on its dueAt day cell", () => {
    const due = new Date(2030, 5, 15, 12, 0, 0);
    h.data = [card("k1", due)];
    vi.setSystemTime(new Date(2030, 5, 1));
    render(<BoardCalendarView boardId="b1" filter={filter} onOpenCard={() => {}} />);
    const cell = document.querySelector('[data-day="2030-6-15"]');
    expect(cell?.textContent).toContain("k1");
    vi.useRealTimers();
  });

  it("prev/next month nav re-queries with new from/to", () => {
    vi.setSystemTime(new Date(2030, 5, 1));
    h.data = [];
    render(<BoardCalendarView boardId="b1" filter={filter} onOpenCard={() => {}} />);
    const before = h.lastInput as { from: Date };
    fireEvent.click(screen.getByLabelText("next month"));
    const after = h.lastInput as { from: Date };
    expect(after.from.getMonth()).toBe((before.from.getMonth() + 1) % 12);
    vi.useRealTimers();
  });

  it("applies filterCards (assignee filter hides non-matching)", () => {
    const due = new Date(2030, 5, 10, 12);
    h.data = [
      card("mine", due, { assignees: [{ id: "me", email: "me@x.com" }] }),
      card("other", due, { assignees: [{ id: "you", email: "you@x.com" }] }),
    ];
    vi.setSystemTime(new Date(2030, 5, 1));
    render(
      <BoardCalendarView
        boardId="b1"
        filter={{ ...filter, assigneeIds: ["me"] }}
        onOpenCard={() => {}}
      />,
    );
    expect(screen.getByText("mine")).toBeInTheDocument();
    expect(screen.queryByText("other")).toBeNull();
    vi.useRealTimers();
  });

  it("shows loading then empty states", () => {
    h.isLoading = true;
    const { rerender } = render(
      <BoardCalendarView boardId="b1" filter={filter} onOpenCard={() => {}} />,
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    h.isLoading = false;
    h.data = [];
    rerender(<BoardCalendarView boardId="b1" filter={filter} onOpenCard={() => {}} />);
    expect(screen.getByText(/no cards with due dates/i)).toBeInTheDocument();
  });
});
