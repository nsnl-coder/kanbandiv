import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, NavLink } from "react-router-dom";
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
} from "lucide-react";
import { useTRPC } from "../lib/trpc";
import { useAuthStore } from "../hooks/useAuthStore";
import { useSearchStore } from "../hooks/useSearchStore";
import { useSidebarStore } from "../hooks/useSidebarStore";
import { useLogout } from "../hooks/useLogout";
import { useCanAny } from "../features/rbac/hooks/useCan";
import { ADMIN_READ_PERMS } from "../features/rbac/constants";
import { ChangePasswordModal } from "../features/auth/components/ChangePasswordModal";
import { NotificationBell } from "../features/notification/components/NotificationBell";
import { SidebarProject } from "./SidebarProject";
import { CreateProjectModal } from "../features/project/components/CreateProjectModal";

// Persistent left rail: brand, the user's projects for quick switching, and
// account actions. Hidden below md; AppLayout shows a compact top bar instead.
export function Sidebar() {
  const trpc = useTRPC();
  const user = useAuthStore((s) => s.user);
  const canAdmin = useCanAny(ADMIN_READ_PERMS);
  const openSearch = useSearchStore((s) => s.setOpen);
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleCollapsed = useSidebarStore((s) => s.toggle);
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

  const itemBase =
    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition";

  if (collapsed) {
    return (
      <aside className="hidden w-14 shrink-0 flex-col items-center border-r border-slate-200 bg-white py-3 md:flex">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <Link
          to="/"
          aria-label="Home"
          className="mt-1 rounded-lg p-2 text-indigo-600 hover:bg-slate-100"
        >
          <LayoutDashboard className="h-5 w-5" />
        </Link>
        <button
          type="button"
          onClick={() => openSearch(true)}
          aria-label="Search"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setShowCreateProject(true)}
          aria-label="New project"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <Plus className="h-4 w-4" />
        </button>

        <div className="mt-auto flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setShowPassword(true)}
            aria-label="Settings"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
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
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
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
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
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
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1.5 font-semibold text-slate-900">
            <LayoutDashboard className="h-5 w-5 text-indigo-600" />
            Trello Clone
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
        {user ? (
          <p className="mt-1 truncate px-3 text-xs text-slate-500">{user.email}</p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => openSearch(true)}
            className={`${itemBase} flex-1 text-slate-600 hover:bg-slate-100`}
          >
            <Search className="h-4 w-4" />
            Search
          </button>
          <NotificationBell />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between px-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Projects
          </span>
          <button
            type="button"
            onClick={() => setShowCreateProject(true)}
            aria-label="New project"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <nav className="mt-1 flex flex-col gap-0.5">
          {ownedQuery.isLoading ? (
            <p className="px-3 py-2 text-sm text-slate-400">Loading...</p>
          ) : owned.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">No projects yet</p>
          ) : (
            owned.map((p) => <SidebarProject key={p.id} project={p} />)
          )}
        </nav>

        <div className="mt-2">
          <button
            type="button"
            onClick={() => setSharedOpen((o) => !o)}
            aria-expanded={sharedOpen}
            className={`${itemBase} w-full justify-between text-slate-500 hover:bg-slate-100`}
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
                <p className="px-3 py-2 text-sm text-slate-400">
                  No shared projects
                </p>
              ) : (
                shared.map((p) => <SidebarProject key={p.id} project={p} />)
              )}
            </nav>
          ) : null}
        </div>
      </div>

      <div className="border-t border-slate-200 p-3">
        <button
          type="button"
          onClick={() => setShowPassword(true)}
          className={`${itemBase} w-full text-slate-600 hover:bg-slate-100`}
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
        {canAdmin ? (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `${itemBase} ${
                isActive
                  ? "bg-indigo-50 font-medium text-indigo-700"
                  : "text-slate-600 hover:bg-slate-100"
              }`
            }
          >
            <Shield className="h-4 w-4" />
            Admin
          </NavLink>
        ) : null}

        <div className="mt-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={logout.run}
            disabled={logout.pending}
            className={`${itemBase} w-full text-slate-600 hover:bg-slate-100 disabled:opacity-50`}
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
    </aside>
  );
}
