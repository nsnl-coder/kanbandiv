import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { BoardData, Card, Label } from "shared";

const h = vi.hoisted(() => ({ labels: [] as Label[] }));

vi.mock("../../../lib/trpc", () => {
  const leaf = () => ({ queryOptions: (input: unknown) => ({ queryKey: ["list", input] }) });
  const proxy = new Proxy({}, { get: () => new Proxy({}, { get: () => leaf() }) });
  return { useTRPC: () => proxy };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: h.labels, isLoading: false, error: null }),
}));

const { BoardSwimlanesView } = await import("./BoardSwimlanesView");

const label = (id: string, name: string): Label => ({
  id,
  boardId: "b1",
  name,
  color: "#61bd4f",
  createdAt: new Date(),
  updatedAt: new Date(),
});

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id,
  columnId: "c1",
  title: id,
  description: null,
  position: 0,
  dueAt: null,
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

const col = (cards: Card[]): BoardData["columns"][number] => ({
  id: "c1",
  boardId: "b1",
  name: "Todo",
  position: 0,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  cards,
});

function laneHasCard(laneLabel: string, title: string): boolean {
  const lane = screen.getByLabelText(`lane ${laneLabel}`);
  return within(lane)
    .queryAllByRole("button")
    .some((b) => (b.textContent ?? "").includes(title));
}

beforeEach(() => {
  h.labels = [];
});

describe("BoardSwimlanesView by label", () => {
  it("a card with 2 labels appears in both lanes; no-label card in No label", () => {
    h.labels = [label("la", "Alpha"), label("lb", "Beta")];
    const two = card("two", { labels: [label("la", "Alpha"), label("lb", "Beta")] });
    const none = card("none");
    render(
      <BoardSwimlanesView boardId="b1" columns={[col([two, none])]} swimlaneBy="label" onOpenCard={() => {}} />,
    );
    expect(laneHasCard("Alpha", "two")).toBe(true);
    expect(laneHasCard("Beta", "two")).toBe(true);
    expect(laneHasCard("No label", "none")).toBe(true);
  });
});

describe("BoardSwimlanesView by assignee", () => {
  it("multi-assignee card in each lane; unassigned in Unassigned", () => {
    const multi = card("multi", {
      assignees: [
        { id: "u1", email: "alice@x.com" },
        { id: "u2", email: "bob@x.com" },
      ],
    });
    const none = card("none");
    render(
      <BoardSwimlanesView boardId="b1" columns={[col([multi, none])]} swimlaneBy="assignee" onOpenCard={() => {}} />,
    );
    expect(laneHasCard("alice", "multi")).toBe(true);
    expect(laneHasCard("bob", "multi")).toBe(true);
    expect(laneHasCard("Unassigned", "none")).toBe(true);
  });

  it("derives assignee lanes from cards, not a members prop (no lane for absent member)", () => {
    const c = card("c", { assignees: [{ id: "u1", email: "alice@x.com" }] });
    render(
      <BoardSwimlanesView boardId="b1" columns={[col([c])]} swimlaneBy="assignee" onOpenCard={() => {}} />,
    );
    expect(screen.queryByLabelText("lane bob")).toBeNull();
  });
});
