import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Card } from "shared";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));
vi.mock("@dnd-kit/utilities", () => ({ CSS: { Translate: { toString: () => undefined } } }));

const { CardTile } = await import("./CardTile");

function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "k1",
    columnId: "c1",
    title: "Card 1",
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

describe("CardTile", () => {
  it("renders a badge per label", () => {
    const card = makeCard({
      labels: [
        { id: "l1", boardId: "b1", name: "Bug", color: "#eb5a46", createdAt: new Date(), updatedAt: new Date() },
        { id: "l2", boardId: "b1", name: "Feat", color: "#61bd4f", createdAt: new Date(), updatedAt: new Date() },
      ],
    });
    render(<CardTile card={card} editable onOpen={() => {}} />);
    expect(screen.getByLabelText("Bug")).toBeInTheDocument();
    expect(screen.getByLabelText("Feat")).toBeInTheDocument();
  });

  it("shows the due badge when a due date is set", () => {
    const card = makeCard({ dueAt: new Date(Date.now() + 5 * 24 * 3600 * 1000) });
    render(<CardTile card={card} editable onOpen={() => {}} />);
    expect(screen.getByText(/.+/, { selector: "[data-due-state]" })).toBeInTheDocument();
  });

  it("shows the comment count when > 0", () => {
    render(<CardTile card={makeCard({ commentCount: 3 })} editable onOpen={() => {}} />);
    expect(screen.getByLabelText("3 comments")).toBeInTheDocument();
  });

  it("hides the comment count when 0", () => {
    render(<CardTile card={makeCard()} editable onOpen={() => {}} />);
    expect(screen.queryByLabelText("0 comments")).toBeNull();
  });
});
