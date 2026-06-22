import { create } from "zustand";

// Collapsed state for the left rail, shared by the app + admin sidebars and
// persisted so the choice survives reloads and navigation between layouts.
const KEY = "sidebar:collapsed";
// User-chosen height (px) of the "Shared with me" section; null = default cap.
const SHARED_KEY = "sidebar:sharedHeight";

function readSharedHeight(): number | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(SHARED_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
  sharedHeight: number | null;
  setSharedHeight: (h: number | null) => void;
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
  sharedHeight: readSharedHeight(),
  setSharedHeight: (h) => {
    try {
      if (h == null) localStorage.removeItem(SHARED_KEY);
      else localStorage.setItem(SHARED_KEY, String(Math.round(h)));
    } catch {
      // ignore storage failures
    }
    set({ sharedHeight: h });
  },
}));
