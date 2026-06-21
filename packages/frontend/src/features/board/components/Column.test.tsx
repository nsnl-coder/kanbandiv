import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Column as ColumnType } from "shared";

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: unknown }) => children,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
  }),
  verticalListSortingStrategy: {},
}));
vi.mock("@dnd-kit/utilities", () => ({ CSS: { Translate: { toString: () => undefined } } }));

const { Column } = await import("./Column");

function makeColumn(): ColumnType {
  return {
    id: "c1",
    boardId: "b1",
    name: "Todo",
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    cards: [],
  };
}

function renderColumn(editable: boolean, onArchive = vi.fn()) {
  render(
    <Column
      column={makeColumn()}
      editable={editable}
      onRename={vi.fn()}
      onArchive={onArchive}
      onAddCard={vi.fn()}
      onOpenCard={vi.fn()}
    />,
  );
  return onArchive;
}

describe("Column archive", () => {
  it("editor sees Archive (not Delete)", () => {
    renderColumn(true);
    expect(screen.getByRole("button", { name: "archive Todo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "delete Todo" })).toBeNull();
  });

  it("clicking archive calls onArchive", async () => {
    const u = userEvent.setup();
    const onArchive = renderColumn(true);
    await u.click(screen.getByRole("button", { name: "archive Todo" }));
    expect(onArchive).toHaveBeenCalled();
  });

  it("view-only hides the archive control", () => {
    renderColumn(false);
    expect(screen.queryByRole("button", { name: "archive Todo" })).toBeNull();
  });
});
