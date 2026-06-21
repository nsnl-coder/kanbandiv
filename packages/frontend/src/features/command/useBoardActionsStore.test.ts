import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBoardActionsStore } from "./useBoardActionsStore";
import type { BoardActionsCtx, BoardActionsHandlers } from "./useBoardActionsStore";

function handlers(): BoardActionsHandlers {
  return {
    setView: vi.fn(),
    openArchived: vi.fn(),
    openHistory: vi.fn(),
    openLabels: vi.fn(),
    openTemplates: vi.fn(),
    openAccess: vi.fn(),
    clearFilters: vi.fn(),
    newCard: vi.fn(),
  };
}

function ctx(boardId: string): BoardActionsCtx {
  return { projectId: "p1", boardId, boardName: "B", canEdit: true, isOwner: true };
}

beforeEach(() => {
  useBoardActionsStore.setState({ ctx: null, handlers: null });
});

describe("useBoardActionsStore", () => {
  it("register sets ctx + handlers", () => {
    useBoardActionsStore.getState().register(ctx("b1"), handlers());
    expect(useBoardActionsStore.getState().ctx?.boardId).toBe("b1");
    expect(useBoardActionsStore.getState().handlers).not.toBeNull();
  });

  it("clear(boardId) is a no-op when the store holds a DIFFERENT board", () => {
    useBoardActionsStore.getState().register(ctx("b2"), handlers());
    // Stale page A unmounts late and clears its own boardId b1.
    useBoardActionsStore.getState().clear("b1");
    expect(useBoardActionsStore.getState().ctx?.boardId).toBe("b2");
    expect(useBoardActionsStore.getState().handlers).not.toBeNull();
  });

  it("clear(boardId) clears when the store holds THAT board", () => {
    useBoardActionsStore.getState().register(ctx("b1"), handlers());
    useBoardActionsStore.getState().clear("b1");
    expect(useBoardActionsStore.getState().ctx).toBeNull();
    expect(useBoardActionsStore.getState().handlers).toBeNull();
  });
});
