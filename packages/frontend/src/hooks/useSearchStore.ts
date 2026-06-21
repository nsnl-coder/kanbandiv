import { create } from "zustand";

// Open state for the global search palette. A tiny store so both triggers
// (sidebar + mobile header) and the Cmd/Ctrl+K handler toggle one instance.
interface SearchState {
  open: boolean;
  setOpen: (v: boolean) => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
