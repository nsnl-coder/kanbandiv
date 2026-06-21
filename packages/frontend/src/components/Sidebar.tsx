import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, useLocation } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LayoutDashboard,
  Plus,
  ChevronDown,
  Settings,
  Shield,
  LogOut,
  Search,
  PanelLeftClose,
  PanelLeft,
  X,
} from "lucide-react";
import { useTRPC } from "../lib/trpc";
import { useAuthStore } from "../hooks/useAuthStore";
import { useSearchStore } from "../hooks/useSearchStore";
import { useSidebarStore } from "../hooks/useSidebarStore";
import { useUiStore } from "../hooks/useUiStore";
import { useLogout } from "../hooks/useLogout";
import { useCanAny } from "../features/rbac/hooks/useCan";
import { ADMIN_READ_PERMS } from "../features/rbac/constants";
import { ChangePasswordModal } from "../features/auth/components/ChangePasswordModal";
import { NotificationBell } from "../features/notification/components/NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { SidebarProject } from "./SidebarProject";
import { CreateProjectModal } from "../features/project/components/CreateProjectModal";

const itemBase = "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition";

// Expanded sidebar body, shared by the desktop rail and the mobile drawer.
// `headerAction` is the top-right control (collapse on desktop, close on mobile).
function SidebarContent({ headerAction }: { headerAction?: ReactNode }) {
  const trpc = useTRPC();
  const user = useAuthStore((s) => s.user);
  const canAdmin = useCanAny(ADMIN_READ_PERMS);
  const openSearch = useSearchStore((s) => s.setOpen);
  const [showPassword, setShowPassword] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [sharedOpen, setSharedOpen] = useState(false);
  const logout = useLogout();

  const ownedQuery = useQuery(
    trpc.projects.list.queryOptions({ filter: "owned", limit: 100, offset: 0 }),
  );
  const sharedQuery = useQuery(
    trpc.projects.list.queryOptions({ filter: "shared", limit: 100, offset: 0 }),
  );
  const owned = ownedQuery.data ?? [];
  const shared = sharedQuery.data ?? [];

  return (
    <>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1.5 font-semibold text-foreground">
            <LayoutDashboard className="h-5 w-5 text-indigo-600" />
            Trello Clone
          </Link>
          {headerAction}
        </div>
        {user ? (
          <p className="mt-1 truncate px-3 text-xs text-muted">{user.email}</p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => openSearch(true)}
            className={`${itemBase} flex-1 text-foreground/70 hover:bg-surface-muted`}
          >
            <Search className="h-4 w-4" />
            Search
          </button>
          <NotificationBell />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between px-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Projects
          </span>
          <button
            type="button"
            onClick={() => setShowCreateProject(true)}
            aria-label="New project"
            className="rounded p-1 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <nav className="mt-1 flex flex-col gap-0.5">
          {ownedQuery.isLoading ? (
            <p className="px-3 py-2 text-sm text-muted">Loading...</p>
          ) : owned.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">No projects yet</p>
          ) : (
            owned.map((p) => <SidebarProject key={p.id} project={p} />)
          )}
        </nav>

        <div className="mt-2">
          <button
            type="button"
            onClick={() => setSharedOpen((o) => !o)}
            aria-expanded={sharedOpen}
            className={`${itemBase} w-full justify-between text-muted hover:bg-surface-muted`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide">
              Shared with me
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${sharedOpen ? "rotate-180" : ""}`}
            />
          </button>
          {sharedOpen ? (
            <nav className="mt-0.5 flex flex-col gap-0.5">
              {shared.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted">No shared projects</p>
              ) : (
                shared.map((p) => <SidebarProject key={p.id} project={p} />)
              )}
            </nav>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={() => setShowPassword(true)}
          className={`${itemBase} w-full text-foreground/80 hover:bg-surface-muted`}
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
        <ThemeToggle />
        {canAdmin ? (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `${itemBase} ${
                isActive
                  ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                  : "text-foreground/80 hover:bg-surface-muted"
              }`
            }
          >
            <Shield className="h-4 w-4" />
            Admin
          </NavLink>
        ) : null}

        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            onClick={logout.run}
            disabled={logout.pending}
            className={`${itemBase} w-full text-foreground/80 hover:bg-surface-muted disabled:opacity-50`}
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </div>

      {showPassword ? (
        <ChangePasswordModal onClose={() => setShowPassword(false)} />
      ) : null}
      <CreateProjectModal
        open={showCreateProject}
        onClose={() => setShowCreateProject(false)}
      />
    </>
  );
}

// Persistent left rail (desktop only). Hidden below md; the mobile drawer
// (MobileNav) renders the same content from the AppLayout top bar.
export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const canAdmin = useCanAny(ADMIN_READ_PERMS);
  const openSearch = useSearchStore((s) => s.setOpen);
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleCollapsed = useSidebarStore((s) => s.toggle);
  const [showPassword, setShowPassword] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const logout = useLogout();

  if (collapsed) {
    return (
      <aside className="hidden w-14 shrink-0 flex-col items-center border-r border-border bg-surface py-3 md:flex">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <Link
          to="/"
          aria-label="Home"
          className="mt-1 rounded-lg p-2 text-indigo-600 hover:bg-surface-muted"
        >
          <LayoutDashboard className="h-5 w-5" />
        </Link>
        <button
          type="button"
          onClick={() => openSearch(true)}
          aria-label="Search"
          className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setShowCreateProject(true)}
          aria-label="New project"
          className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>

        <div className="mt-auto flex flex-col items-center gap-1">
          <ThemeToggle compact />
          <button
            type="button"
            onClick={() => setShowPassword(true)}
            aria-label="Settings"
            className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
          {canAdmin ? (
            <NavLink
              to="/admin"
              aria-label="Admin"
              className={({ isActive }) =>
                `rounded-lg p-2 ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                    : "text-muted hover:bg-surface-muted hover:text-foreground"
                }`
              }
            >
              <Shield className="h-4 w-4" />
            </NavLink>
          ) : null}
          <button
            type="button"
            onClick={logout.run}
            disabled={logout.pending}
            aria-label="Log out"
            className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {showPassword ? (
          <ChangePasswordModal onClose={() => setShowPassword(false)} />
        ) : null}
        <CreateProjectModal
          open={showCreateProject}
          onClose={() => setShowCreateProject(false)}
        />
      </aside>
    );
  }

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <SidebarContent
        headerAction={
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        }
      />
    </aside>
  );
}

// Mobile slide-over drawer with the full sidebar content. Closes on navigation.
export function MobileNav() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, setOpen]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl focus:outline-none md:hidden"
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <SidebarContent
            headerAction={
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close menu"
                  className="rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            }
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
