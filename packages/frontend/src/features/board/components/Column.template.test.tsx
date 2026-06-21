import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Column as ColumnType, CardTemplate } from "shared";

const h = vi.hoisted(() => ({ queryData: {} as Record<string, unknown> }));

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

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryOptions: (input: unknown) => ({ queryKey: [path, input] }),
    queryKey: (input?: unknown) => [path, input],
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
}));

const { Column } = await import("./Column");

const payload = { description: null, coverColor: null, labelIds: [], checklists: [] };
const templates: CardTemplate[] = [
  { id: "t1", boardId: "b1", name: "Bug", payload, createdAt: new Date(), updatedAt: new Date() },
];

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

function renderColumn(editable: boolean, onAddFromTemplate = vi.fn()) {
  render(
    <Column
      column={makeColumn()}
      boardId="b1"
      editable={editable}
      onRename={vi.fn()}
      onArchive={vi.fn()}
      onAddCard={vi.fn()}
      onAddFromTemplate={onAddFromTemplate}
      onOpenCard={vi.fn()}
    />,
  );
  return onAddFromTemplate;
}

beforeEach(() => {
  h.queryData = { list: templates };
});

describe("Column from-template", () => {
  it("shows the From template control only when editable", () => {
    renderColumn(true);
    expect(screen.getByLabelText("add card from template to Todo")).toBeInTheDocument();
  });

  it("hides the From template control for view-only", () => {
    renderColumn(false);
    expect(screen.queryByLabelText("add card from template to Todo")).toBeNull();
  });

  it("picking a template calls onAddFromTemplate with its id", async () => {
    const u = userEvent.setup();
    const onAddFromTemplate = renderColumn(true);
    await u.click(screen.getByLabelText("add card from template to Todo"));
    await u.click(screen.getByLabelText("use template Bug"));
    expect(onAddFromTemplate).toHaveBeenCalledWith("t1");
  });
});
