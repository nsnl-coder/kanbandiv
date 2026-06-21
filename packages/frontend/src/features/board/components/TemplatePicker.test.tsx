import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CardTemplate } from "shared";

const h = vi.hoisted(() => ({ queryData: {} as Record<string, unknown> }));

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

const { TemplatePicker } = await import("./TemplatePicker");

const payload = { description: null, coverColor: null, labelIds: [], checklists: [] };
const templates: CardTemplate[] = [
  { id: "t1", boardId: "b1", name: "Bug", payload, createdAt: new Date(), updatedAt: new Date() },
  { id: "t2", boardId: "b1", name: "Feature", payload, createdAt: new Date(), updatedAt: new Date() },
];

beforeEach(() => {
  h.queryData = { list: templates };
});

describe("TemplatePicker", () => {
  it("renders the board's templates", () => {
    render(<TemplatePicker boardId="b1" onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
  });

  it("picking one calls onPick with the template id", async () => {
    const u = userEvent.setup();
    const onPick = vi.fn();
    render(<TemplatePicker boardId="b1" onPick={onPick} onClose={vi.fn()} />);
    await u.click(screen.getByLabelText("use template Feature"));
    expect(onPick).toHaveBeenCalledWith("t2");
  });

  it("shows empty state when none", () => {
    h.queryData = { list: [] };
    render(<TemplatePicker boardId="b1" onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("No templates yet.")).toBeInTheDocument();
  });
});
