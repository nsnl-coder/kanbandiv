import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useNavigate } from "react-router-dom";
import { ChevronUp, LogOut, Monitor, Moon, Settings, Shield, Sun } from "lucide-react";
import { useAuthStore } from "../hooks/useAuthStore";
import { useLogout } from "../hooks/useLogout";
import { useThemeStore, type Theme } from "../hooks/useThemeStore";
import { useCanAny } from "../features/rbac/hooks/useCan";
import { ADMIN_READ_PERMS } from "../features/rbac/constants";

const ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground/80 outline-none transition-colors data-[highlighted]:bg-surface-muted";
const ICON = "h-4 w-4 text-muted";

const THEME_ORDER: Theme[] = ["light", "dark", "system"];
const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;
const THEME_LABEL = { light: "Light", dark: "Dark", system: "System" } as const;

// Bottom-of-sidebar account control. Collapses Settings / Theme / Admin / Log
// out into a single popover so the project list gets the rest of the column.
export function AccountMenu() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canAdmin = useCanAny(ADMIN_READ_PERMS);
  const logout = useLogout();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const ThemeIcon = THEME_ICON[theme];
  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  const initial = (user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground/80 outline-none transition hover:bg-surface-muted data-[state=open]:bg-surface-muted">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
          {initial}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{user?.email}</span>
        <ChevronUp className="h-4 w-4 shrink-0 text-muted" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-30 w-56 origin-bottom-left rounded-2xl border border-border/80 bg-surface/95 p-1.5 shadow-[0_16px_40px_-12px_rgb(15_23_42/0.30)] backdrop-blur-md"
        >
          <DropdownMenu.Item className={ITEM} onSelect={() => navigate("/settings")}>
            <Settings className={ICON} />
            Settings
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={ITEM}
            onSelect={(e) => {
              e.preventDefault(); // keep open so the user can keep cycling
              setTheme(nextTheme);
            }}
          >
            <ThemeIcon className={ICON} />
            Theme: {THEME_LABEL[theme]}
          </DropdownMenu.Item>

          {canAdmin ? (
            <DropdownMenu.Item className={ITEM} onSelect={() => navigate("/admin")}>
              <Shield className={ICON} />
              Admin
            </DropdownMenu.Item>
          ) : null}

          <DropdownMenu.Separator className="my-1.5 h-px bg-surface-muted" />

          <DropdownMenu.Item
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-rose-600 outline-none transition-colors data-[highlighted]:bg-rose-50"
            onSelect={logout.run}
          >
            <LogOut className="h-4 w-4" />
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
