import { create } from "zustand";

// Light/dark/system theme, persisted so the choice survives reloads.
// Applies the `.dark` class to <html>; `system` follows the OS preference.
const KEY = "theme";

export type Theme = "light" | "dark" | "system";

function readStored(): Theme {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

function prefersDark(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveDark(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && prefersDark());
}

// Applies the resolved theme to the document. Exported so main.tsx can run it
// pre-paint to avoid a flash of the wrong theme.
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveDark(theme));
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  // Keep `system` in sync with OS changes while the app is open.
  if (typeof matchMedia !== "undefined") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (readStored() === "system") applyTheme("system");
    });
  }
  return {
    theme: readStored(),
    setTheme: (theme) => {
      try {
        if (theme === "system") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, theme);
      } catch {
        // ignore storage failures (private mode, etc.)
      }
      applyTheme(theme);
      set({ theme });
    },
  };
});
