import { Link, Outlet } from "react-router-dom";
import { LayoutDashboard, LogOut, Menu, Search } from "lucide-react";
import { useLogout } from "../hooks/useLogout";
import { useSearchStore } from "../hooks/useSearchStore";
import { useUiStore } from "../hooks/useUiStore";
import { SearchPalette } from "../features/search/components/SearchPalette";
import { CommandPalette } from "../features/command/components/CommandPalette";
import { ShortcutHelp } from "../features/command/components/ShortcutHelp";
import { useGlobalShortcuts } from "../features/command/useGlobalShortcuts";
import { NotificationBell } from "../features/notification/components/NotificationBell";
import { useNotificationsRealtime } from "../features/notification/hooks/useNotificationsRealtime";
import { ThemeToggle } from "./ThemeToggle";
import { Sidebar, MobileNav } from "./Sidebar";

// Shell for signed-in app pages: fixed-height row of [sidebar | content].
// Content scrolls on its own so the sidebar stays put while navigating.
export function AppLayout() {
  const logout = useLogout();
  const setOpen = useSearchStore((s) => s.setOpen);
  const openMobileNav = useUiStore((s) => s.setMobileNavOpen);

  // Single per-user SSE stream shared by the desktop + mobile bell.
  useNotificationsRealtime();

  // Global keyboard shortcuts (Cmd/K search, Cmd/P palette, ?, /, c, b, g p).
  useGlobalShortcuts();

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-foreground">
      <Sidebar />
      <MobileNav />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:hidden">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => openMobileNav(true)}
              className="-ml-1 rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link to="/" className="flex items-center gap-1.5 font-semibold text-foreground">
              <LayoutDashboard className="h-5 w-5 text-indigo-600" />
              Trello Clone
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Search"
              onClick={() => setOpen(true)}
              className="text-muted"
            >
              <Search className="h-4 w-4" />
            </button>
            <ThemeToggle compact />
            <NotificationBell />
            <button
              type="button"
              onClick={logout.run}
              disabled={logout.pending}
              aria-label="Log out"
              className="flex items-center gap-1.5 text-sm text-muted disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <Outlet />
      </div>
      <SearchPalette />
      <CommandPalette />
      <ShortcutHelp />
    </div>
  );
}
