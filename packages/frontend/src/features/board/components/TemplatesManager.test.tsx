import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CardTemplate } from "shared";

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
  useMutation: (opts: { _mutationKey: string }) => ({
    mutate: (vars: unknown) => {
      (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
    },
    isPending: false,
    error: null,
  }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));

const { TemplatesManager } = await import("./TemplatesManager");

const payload = { description: null, coverColor: null, labelIds: ["l1"], checklists: [] };
const templates: CardTemplate[] = [
  { id: "t1", boardId: "b1", name: "Bug", payload, createdAt: new Date(), updatedAt: new Date() },
];

beforeEach(() => {
  h.queryData = { list: templates };
  h.mutateCalls = {};
});

describe("TemplatesManager", () => {
  it("lists templates with a summary", () => {
    render(<TemplatesManager boardId="b1" editable />);
    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.getByText("1 labels, 0 checklists")).toBeInTheDocument();
  });

  it("creates a template via the form", async () => {
    const u = userEvent.setup();
    render(<TemplatesManager boardId="b1" editable />);
    await u.click(screen.getByRole("button", { name: "new template" }));
    await u.type(screen.getByLabelText("template name"), "Feature");
    await u.click(screen.getByRole("button", { name: "Create template" }));
    expect(h.mutateCalls.create?.[0]).toMatchObject({ boardId: "b1", name: "Feature" });
  });

  it("edits a template via the form", async () => {
    const u = userEvent.setup();
    render(<TemplatesManager boardId="b1" editable />);
    await u.click(screen.getByLabelText("edit template Bug"));
    const name = screen.getByLabelText("template name");
    await u.clear(name);
    await u.type(name, "Bugfix");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    expect(h.mutateCalls.update?.[0]).toMatchObject({ id: "t1", name: "Bugfix" });
  });

  it("deletes a template", async () => {
    const u = userEvent.setup();
    render(<TemplatesManager boardId="b1" editable />);
    await u.click(screen.getByLabelText("delete template Bug"));
    expect(h.mutateCalls.delete).toContainEqual({ id: "t1" });
  });

  it("hides controls for view-only", () => {
    render(<TemplatesManager boardId="b1" editable={false} />);
    expect(screen.queryByRole("button", { name: "new template" })).toBeNull();
    expect(screen.queryByLabelText("edit template Bug")).toBeNull();
    expect(screen.queryByLabelText("delete template Bug")).toBeNull();
  });
});
