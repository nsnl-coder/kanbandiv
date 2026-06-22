import { createContext, useContext } from "react";
import type { Board } from "shared";

// Shared between Sidebar (DndContext owner) and SidebarProject (item renderer).
// SidebarProject registers its loaded boards so the top-level drag handler can
// resolve a board's source/target project and neighbour ids.
export interface SidebarDndApi {
  registerBoards: (projectId: string, boards: Board[]) => void;
  // While a board drag is in progress, the live arrangement to render instead
  // of each project's query data (canonical dnd-kit cross-container pattern).
  dragBoards: Map<string, Board[]> | null;
  // Project force-expanded because a board is being dragged over it.
  openProjectId: string | null;
}

export const SidebarDndContext = createContext<SidebarDndApi | null>(null);
export const useSidebarDnd = () => useContext(SidebarDndContext);

// Draggable ids are prefixed so projects and boards coexist in one DndContext.
export type DndKind = "project" | "board";

export function dndId(kind: DndKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseDndId(raw: string): { kind: DndKind; id: string } {
  const [kind, ...rest] = raw.split(":");
  return { kind: kind as DndKind, id: rest.join(":") };
}

// Given the desired order of ids and the moved item's id, return the
// neighbours the server needs (afterId = item above, beforeId = item below).
export function neighboursOf(
  orderedIds: string[],
  activeId: string,
): { beforeId?: string; afterId?: string } {
  const idx = orderedIds.indexOf(activeId);
  if (idx === -1) return {};
  return {
    afterId: idx > 0 ? orderedIds[idx - 1] : undefined,
    beforeId: idx < orderedIds.length - 1 ? orderedIds[idx + 1] : undefined,
  };
}
