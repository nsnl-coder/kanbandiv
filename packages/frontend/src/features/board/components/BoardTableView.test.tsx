import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BoardData, Card } from "shared";
import { BoardTableView } from "./BoardTableView";

const card = (id: string, title: string, over: Partial<Card> = {}): Card => ({
  id,
  columnId: "c1",
  title,
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

const col = (id: string, name: string, cards: Card[]): BoardData["columns"][number] => ({
  id,
  boardId: "b1",
  name,
  position: 0,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  cards,
});

function titles(): string[] {
  const rows = screen.getAllByRole("row").slice(1); // skip header
  return rows.map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
}

describe("BoardTableView", () => {
  it("renders one row per card with cells", () => {
    const cols = [
      col("c1", "Todo", [card("k1", "Banana", { assignees: [{ id: "u1", email: "a@x.com" }] })]),
    ];
    render(<BoardTableView columns={cols} onOpenCard={() => {}} />);
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.getByText("Todo")).toBeInTheDocument();
    expect(screen.getByLabelText("assignees")).toBeInTheDocument();
  });

  it("clicking a title calls onOpenCard", async () => {
    const u = userEvent.setup();
    const onOpenCard = vi.fn();
    const cols = [col("c1", "Todo", [card("k1", "Apple")])];
    render(<BoardTableView columns={cols} onOpenCard={onOpenCard} />);
    await u.click(screen.getByText("Apple"));
    expect(onOpenCard).toHaveBeenCalledWith(expect.objectContaining({ id: "k1" }));
  });

  it("sorts by title toggling asc/desc", async () => {
    const u = userEvent.setup();
    const cols = [col("c1", "Todo", [card("k1", "Banana"), card("k2", "Apple")])];
    render(<BoardTableView columns={cols} onOpenCard={() => {}} />);
    // default sort is title-asc
    expect(titles()).toEqual(["Apple", "Banana"]);
    await u.click(screen.getByLabelText("sort by Title"));
    expect(titles()).toEqual(["Banana", "Apple"]);
    await u.click(screen.getByLabelText("sort by Title"));
    expect(titles()).toEqual(["Apple", "Banana"]);
  });

  it("due sort puts null-due rows last in both directions", async () => {
    const u = userEvent.setup();
    const cols = [
      col("c1", "Todo", [
        card("k1", "NoDue"),
        card("k2", "Soon", { dueAt: new Date(Date.now() + 1000) }),
        card("k3", "Later", { dueAt: new Date(Date.now() + 1000000) }),
      ]),
    ];
    render(<BoardTableView columns={cols} onOpenCard={() => {}} />);
    await u.click(screen.getByLabelText("sort by Due"));
    expect(titles()).toEqual(["Soon", "Later", "NoDue"]);
    await u.click(screen.getByLabelText("sort by Due"));
    expect(titles()).toEqual(["Later", "Soon", "NoDue"]);
  });

  it("empty state when no cards", () => {
    render(<BoardTableView columns={[col("c1", "Todo", [])]} onOpenCard={() => {}} />);
    expect(screen.getByText(/no cards match/i)).toBeInTheDocument();
  });
});
