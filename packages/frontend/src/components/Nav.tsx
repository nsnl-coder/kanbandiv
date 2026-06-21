import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, FolderKanban, Settings, Shield, LogOut } from "lucide-react";
import { useTRPC } from "../lib/trpc";
import { useAuthStore } from "../hooks/useAuthStore";
import { useCanAny } from "../features/rbac/hooks/useCan";
import { ADMIN_READ_PERMS } from "../features/rbac/constants";
import { ChangePasswordModal } from "../features/auth/components/ChangePasswordModal";

export function Nav() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const canAdmin = useCanAny(ADMIN_READ_PERMS);
  const [showPassword, setShowPassword] = useState(false);

  const logout = useMutation(trpc.auth.logout.mutationOptions());

  const onLogout = () => {
    logout.mutate(
      {},
      {
        onSettled: () => {
          clearAuth();
          navigate("/login", { replace: true });
        },
      },
    );
  };

  return (
    <nav className="grid grid-cols-3 items-center border-b border-border bg-surface px-4 py-3">
      <div className="flex items-center text-sm">
        <Link to="/" className="flex items-center gap-1.5 font-semibold text-foreground">
          <LayoutDashboard className="h-4 w-4 text-indigo-600" />
          Trello Clone
        </Link>
      </div>
      <div className="flex items-center justify-center gap-6 text-sm">
        <NavLink
          to="/projects"
          className={({ isActive }) =>
            `flex items-center gap-1.5 hover:text-foreground ${
              isActive ? "font-medium text-indigo-600" : "text-foreground/70"
            }`
          }
        >
          <FolderKanban className="h-4 w-4" />
          Projects
        </NavLink>
        <button
          type="button"
          onClick={() => setShowPassword(true)}
          className="flex items-center gap-1.5 text-foreground/70 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
        {canAdmin ? (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-1.5 hover:text-foreground ${
                isActive ? "font-medium text-indigo-600" : "text-foreground/70"
              }`
            }
          >
            <Shield className="h-4 w-4" />
            Admin
          </NavLink>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-3 text-sm">
        {user ? <span className="text-muted">{user.email}</span> : null}
        <button
          type="button"
          onClick={onLogout}
          disabled={logout.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>

      {showPassword ? (
        <ChangePasswordModal onClose={() => setShowPassword(false)} />
      ) : null}
    </nav>
  );
}
