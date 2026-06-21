import { create } from "zustand";

// Open state for the keyboard-shortcuts help overlay (press ?).
interface ShortcutHelpState {
  open: boolean;
  setOpen: (v: boolean) => void;
}

export const useShortcutHelpStore = create<ShortcutHelpState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
