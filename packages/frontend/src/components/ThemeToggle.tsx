import { Sun, Moon, Monitor } from "lucide-react";
import { useThemeStore, type Theme } from "../hooks/useThemeStore";

const ORDER: Theme[] = ["light", "dark", "system"];
const ICON = { light: Sun, dark: Moon, system: Monitor } as const;
const LABEL = { light: "Light", dark: "Dark", system: "System" } as const;

// Cycles light -> dark -> system. `compact` renders an icon-only button for the
// collapsed sidebar / mobile header; otherwise a labelled row.
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = ICON[theme];

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setTheme(next)}
        aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[next]}`}
        title={`Theme: ${LABEL[theme]}`}
        className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground/80 transition hover:bg-surface-muted"
    >
      <Icon className="h-4 w-4" />
      Theme: {LABEL[theme]}
    </button>
  );
}
