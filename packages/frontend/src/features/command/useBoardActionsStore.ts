import { create } from "zustand";
import type { BoardViewModeValue } from "shared";

// Context describing the active board page; null when no board is mounted.
export interface BoardActionsCtx {
  projectId: string;
  boardId: string;
  boardName: string;
  canEdit: boolean;
  isOwner: boolean;
}

// Callbacks registered by the active BoardDetailPage so a GLOBAL palette /
// shortcut layer can drive its LOCAL view + panel state.
export interface BoardActionsHandlers {
  setView: (mode: BoardViewModeValue) => void;
  openArchived: () => void;
  openHistory: () => void;
  openLabels: () => void;
  openTemplates: () => void;
  openAccess: () => void;
  clearFilters: () => void;
  newCard: () => void;
}

interface BoardActionsState {
  ctx: BoardActionsCtx | null;
  handlers: BoardActionsHandlers | null;
  register: (ctx: BoardActionsCtx, handlers: BoardActionsHandlers) => void;
  // No-op unless the store still holds THIS boardId. Prevents a late-unmounting
  // page (StrictMode double-invoke, or A->B nav) from wiping a fresh board's
  // registration.
  clear: (boardId: string) => void;
}

export const useBoardActionsStore = create<BoardActionsState>((set, get) => ({
  ctx: null,
  handlers: null,
  register: (ctx, handlers) => set({ ctx, handlers }),
  clear: (boardId) => {
    if (get().ctx?.boardId === boardId) set({ ctx: null, handlers: null });
  },
}));
