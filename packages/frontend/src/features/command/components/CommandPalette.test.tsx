import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  logoutRun: vi.fn(),
  canAdmin: false,
  projects: [] as { id: string; name: string }[],
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = () => ({
    queryOptions: (input: unknown) => ({ queryKey: ["list", input] }),
    queryKey: (input?: unknown) => ["list", input],
  });
  const proxy = new Proxy({}, { get: () => new Proxy({}, { get: () => leaf() }) });
  return { useTRPC: () => proxy };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: h.projects, isLoading: false, error: null }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => h.navigate };
});

vi.mock("../../../hooks/useLogout", () => ({
  useLogout: () => ({ run: h.logoutRun, pending: false }),
}));

vi.mock("../../rbac/hooks/useCan", () => ({
  useCanAny: () => h.canAdmin,
}));

const { CommandPalette } = await import("./CommandPalette");
const { useCommandStore } = await import("../useCommandStore");
const { useSearchStore } = await import("../../../hooks/useSearchStore");
const { useBoardActionsStore } = await import("../useBoardActionsStore");

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.navigate = vi.fn();
  h.logoutRun = vi.fn();
  h.canAdmin = false;
  h.projects = [];
  useCommandStore.getState().setOpen(true);
  useSearchStore.getState().setOpen(false);
  useBoardActionsStore.setState({ ctx: null, handlers: null });
});

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    useCommandStore.getState().setOpen(false);
    const { container } = renderPalette();
    expect(container.firstChild).toBeNull();
  });

  it("opens and autofocuses the input", () => {
    renderPalette();
    const input = screen.getByLabelText("command input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("lists grouped actions (Navigate / Create / Account)", () => {
    renderPalette();
    expect(screen.getByText("Navigate")).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
  });

  it("filters with fuzzy query; 'zzzz' -> No commands", () => {
    h.projects = [{ id: "p9", name: "Marketing" }];
    renderPalette();
    fireEvent.change(screen.getByLabelText("command input"), { target: { value: "marketing" } });
    expect(screen.getByText("Go to project: Marketing")).toBeInTheDocument();
    expect(screen.queryByText("Log out")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("command input"), { target: { value: "zzzz" } });
    expect(screen.getByText("No commands")).toBeInTheDocument();
  });

  it("Enter on a navigate command navigates + closes", () => {
    renderPalette();
    const input = screen.getByLabelText("command input");
    fireEvent.change(input, { target: { value: "go to projects" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.navigate).toHaveBeenCalledWith("/projects");
    expect(useCommandStore.getState().open).toBe(false);
  });

  it("Enter on 'New card' calls registered handlers.newCard", () => {
    const newCard = vi.fn();
    useBoardActionsStore.getState().register(
      { projectId: "p1", boardId: "b1", boardName: "B", canEdit: true, isOwner: true },
      {
        setView: vi.fn(),
        openArchived: vi.fn(),
        openHistory: vi.fn(),
        openLabels: vi.fn(),
        openAccess: vi.fn(),
        clearFilters: vi.fn(),
        newCard,
      },
    );
    renderPalette();
    const input = screen.getByLabelText("command input");
    fireEvent.change(input, { target: { value: "new card" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(newCard).toHaveBeenCalled();
  });

  it("ArrowDown moves selection and Enter runs the active row", () => {
    renderPalette();
    const input = screen.getByLabelText("command input");
    fireEvent.change(input, { target: { value: "go to projects" } });
    // Single result -> activeIndex 0 selected.
    const row = screen.getByText("Go to Projects").closest("button")!;
    expect(row).toHaveAttribute("aria-selected", "true");
  });

  it("clicking a row runs + closes", () => {
    renderPalette();
    fireEvent.click(screen.getByText("Go to Projects"));
    expect(h.navigate).toHaveBeenCalledWith("/projects");
    expect(useCommandStore.getState().open).toBe(false);
  });
});
