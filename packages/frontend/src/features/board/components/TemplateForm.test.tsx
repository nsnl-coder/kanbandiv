import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Label, CardTemplatePayload } from "shared";

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

const { TemplateForm } = await import("./TemplateForm");

const labels: Label[] = [
  { id: "l1", boardId: "b1", name: "Bug", color: "#eb5a46", createdAt: new Date(), updatedAt: new Date() },
];

beforeEach(() => {
  h.queryData = { list: labels };
});

describe("TemplateForm", () => {
  it("emits name + payload with labels, description, cleaned checklist", async () => {
    const u = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TemplateForm boardId="b1" onSubmit={onSubmit} onCancel={vi.fn()} />);

    await u.type(screen.getByLabelText("template name"), "Bug report");
    await u.type(screen.getByLabelText("template description"), "fill me");
    await u.click(screen.getByLabelText("toggle label Bug"));
    await u.click(screen.getByLabelText("add checklist"));
    await u.type(screen.getByLabelText("checklist 1 title"), "Steps");
    await u.type(screen.getByLabelText("checklist 1 item 1"), "first");
    await u.click(screen.getByLabelText("add item to checklist 1"));
    // leave item 2 blank -> dropped
    await u.click(screen.getByRole("button", { name: "Save template" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0][0] as { name: string; payload: CardTemplatePayload };
    expect(arg.name).toBe("Bug report");
    expect(arg.payload.description).toBe("fill me");
    expect(arg.payload.labelIds).toEqual(["l1"]);
    expect(arg.payload.checklists).toEqual([{ title: "Steps", items: ["first"] }]);
  });

  it("picks a cover color", async () => {
    const u = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TemplateForm boardId="b1" onSubmit={onSubmit} onCancel={vi.fn()} />);
    await u.type(screen.getByLabelText("template name"), "T");
    await u.click(screen.getByLabelText("cover color blue"));
    await u.click(screen.getByRole("button", { name: "Save template" }));
    const arg = onSubmit.mock.calls[0][0] as { payload: CardTemplatePayload };
    expect(arg.payload.coverColor).toBe("blue");
  });

  it("blocks submit when name is empty", async () => {
    const u = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TemplateForm boardId="b1" onSubmit={onSubmit} onCancel={vi.fn()} />);
    await u.click(screen.getByRole("button", { name: "Save template" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("prefills from initial values", () => {
    const payload: CardTemplatePayload = {
      description: "pre",
      coverColor: "red",
      labelIds: ["l1"],
      checklists: [{ title: "Done", items: ["a"] }],
    };
    render(
      <TemplateForm
        boardId="b1"
        initialName="Existing"
        initialPayload={payload}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("template name")).toHaveValue("Existing");
    expect(screen.getByLabelText("template description")).toHaveValue("pre");
    expect(screen.getByLabelText("checklist 1 title")).toHaveValue("Done");
  });
});
