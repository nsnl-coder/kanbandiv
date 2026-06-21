import { create } from "zustand";

// Collapsed state for the left rail, shared by the app + admin sidebars and
// persisted so the choice survives reloads and navigation between layouts.
const KEY = "sidebar:collapsed";

interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1",
  toggle: () =>
    set((s) => {
      const collapsed = !s.collapsed;
      try {
        localStorage.setItem(KEY, collapsed ? "1" : "0");
      } catch {
        // ignore storage failures (private mode, etc.)
      }
      return { collapsed };
    }),
}));
