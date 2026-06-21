import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Assignee } from "shared";

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

const { AssigneeFilterBar } = await import("./AssigneeFilterBar");

const alice: Assignee = { id: "u1", email: "alice@example.com" };
const bob: Assignee = { id: "u2", email: "bob@example.com" };

const noop = () => {};

beforeEach(() => {
  h.queryData = { boardMembers: [alice, bob] };
});

describe("AssigneeFilterBar", () => {
  it("selecting a member calls onChange with its id", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AssigneeFilterBar
        boardId="b1"
        selected={[]}
        onChange={onChange}
        assignedToMe={false}
        onAssignedToMeChange={noop}
        currentUserId="u1"
      />,
    );
    await u.click(screen.getByLabelText("filter alice"));
    expect(onChange).toHaveBeenCalledWith(["u1"]);
  });

  it("'assigned to me' toggle is hidden when there is no current user id", () => {
    render(
      <AssigneeFilterBar
        boardId="b1"
        selected={[]}
        onChange={noop}
        assignedToMe={false}
        onAssignedToMeChange={noop}
        currentUserId=""
      />,
    );
    expect(screen.queryByLabelText("filter assigned to me")).toBeNull();
  });

  it("'assigned to me' toggle fires onAssignedToMeChange", async () => {
    const u = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <AssigneeFilterBar
        boardId="b1"
        selected={[]}
        onChange={noop}
        assignedToMe={false}
        onAssignedToMeChange={onToggle}
        currentUserId="u1"
      />,
    );
    await u.click(screen.getByLabelText("filter assigned to me"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("clear resets both selection and assigned-to-me", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    const onToggle = vi.fn();
    render(
      <AssigneeFilterBar
        boardId="b1"
        selected={["u1"]}
        onChange={onChange}
        assignedToMe
        onAssignedToMeChange={onToggle}
        currentUserId="u1"
      />,
    );
    await u.click(screen.getByLabelText("clear assignee filter"));
    expect(onChange).toHaveBeenCalledWith([]);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("renders nothing when there are no board members", () => {
    h.queryData = { boardMembers: [] };
    const { container } = render(
      <AssigneeFilterBar
        boardId="b1"
        selected={[]}
        onChange={noop}
        assignedToMe={false}
        onAssignedToMeChange={noop}
        currentUserId="u1"
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
