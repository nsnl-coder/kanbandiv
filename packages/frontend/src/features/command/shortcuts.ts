// Single source of truth for the keyboard-shortcut map. The help overlay
// renders these rows; the registry reuses the `keys` strings as display hints.
export interface ShortcutRow {
  keys: string[];
  description: string;
  contextNote?: string;
}

export const SHORTCUTS: ShortcutRow[] = [
  { keys: ["Cmd/Ctrl", "K"], description: "Open card search" },
  { keys: ["/"], description: "Open card search" },
  { keys: ["Cmd/Ctrl", "P"], description: "Open command palette", contextNote: "Overrides browser Print" },
  { keys: ["?"], description: "Open this shortcuts help" },
  { keys: ["c"], description: "New card on current board", contextNote: "Board + edit access + a column" },
  { keys: ["g", "p"], description: "Go to Projects" },
  { keys: ["Esc"], description: "Close open overlay" },
];
