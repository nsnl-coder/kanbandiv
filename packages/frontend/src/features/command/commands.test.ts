import { describe, it, expect, vi } from "vitest";
import { buildCommands, type BuildCommandsArgs } from "./commands";
import type { BoardActionsCtx, BoardActionsHandlers } from "./useBoardActionsStore";

function handlers(): BoardActionsHandlers {
  return {
    setView: vi.fn(),
    openArchived: vi.fn(),
    openHistory: vi.fn(),
    openLabels: vi.fn(),
    openAccess: vi.fn(),
    clearFilters: vi.fn(),
    newCard: vi.fn(),
  };
}

function ctx(over: Partial<BoardActionsCtx> = {}): BoardActionsCtx {
  return {
    projectId: "p1",
    boardId: "b1",
    boardName: "Sprint",
    canEdit: true,
    isOwner: true,
    ...over,
  };
}

function build(over: Partial<BuildCommandsArgs> = {}) {
  return buildCommands({
    navigate: vi.fn(),
    ctx: null,
    handlers: null,
    logout: vi.fn(),
    projects: [],
    openSearch: vi.fn(),
    openHelp: vi.fn(),
    setOpen: vi.fn(),
    canAdmin: false,
    ...over,
  });
}

const labels = (cmds: ReturnType<typeof build>) => cmds.map((c) => c.label);

describe("buildCommands", () => {
  it("no board ctx: navigate + create + account, no board actions / new card / new board", () => {
    const l = labels(build());
    expect(l).toContain("Go to Projects");
    expect(l).toContain("New project");
    expect(l).toContain("Log out");
    expect(l).toContain("Keyboard shortcuts");
    expect(l).toContain("Search cards");
    expect(l).not.toContain("New card on current board");
    expect(l).not.toContain("New board");
    expect(l).not.toContain("Switch to Table view");
  });

  it("board ctx canEdit+owner: includes table view, archived, new card, clear filters, access", () => {
    const l = labels(build({ ctx: ctx(), handlers: handlers() }));
    expect(l).toContain("Switch to Table view");
    expect(l).toContain("Open Archived items");
    expect(l).toContain("New card on current board");
    expect(l).toContain("Clear filters");
    expect(l).toContain("Board members / access");
  });

  it("board ctx canEdit:false excludes new card, labels, archived; keeps view + history + clear", () => {
    const l = labels(build({ ctx: ctx({ canEdit: false, isOwner: false }), handlers: handlers() }));
    expect(l).not.toContain("New card on current board");
    expect(l).not.toContain("Manage labels");
    expect(l).not.toContain("Open Archived items");
    expect(l).toContain("Switch to Table view");
    expect(l).toContain("Open History");
    expect(l).toContain("Clear filters");
  });

  it("board ctx isOwner:false excludes board access", () => {
    const l = labels(build({ ctx: ctx({ isOwner: false }), handlers: handlers() }));
    expect(l).not.toContain("Board members / access");
  });

  it("New board present only with ctx and navigates to /projects/<id>", () => {
    expect(labels(build())).not.toContain("New board");
    const navigate = vi.fn();
    const setOpen = vi.fn();
    const cmds = build({ ctx: ctx(), handlers: handlers(), navigate, setOpen });
    const newBoard = cmds.find((c) => c.label === "New board")!;
    expect(newBoard).toBeDefined();
    newBoard.run();
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(navigate).toHaveBeenCalledWith("/projects/p1");
  });

  it("Admin present only when canAdmin", () => {
    expect(labels(build())).not.toContain("Admin");
    expect(labels(build({ canAdmin: true }))).toContain("Admin");
  });

  it("New card run calls handlers.newCard after closing", () => {
    const h = handlers();
    const setOpen = vi.fn();
    const cmds = build({ ctx: ctx(), handlers: h, setOpen });
    cmds.find((c) => c.label === "New card on current board")!.run();
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(h.newCard).toHaveBeenCalled();
  });
});
