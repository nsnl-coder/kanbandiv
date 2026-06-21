import { create } from "zustand";

// Open state for the command palette (Cmd/Ctrl+P). Mirrors useSearchStore so
// the hook + any trigger toggle one instance.
interface CommandState {
  open: boolean;
  setOpen: (v: boolean) => void;
}

export const useCommandStore = create<CommandState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
