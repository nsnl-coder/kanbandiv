import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useTRPC } from "../lib/trpc";
import { useAuthStore } from "../hooks/useAuthStore";
import { useCanAny } from "../features/rbac/hooks/useCan";
import { ADMIN_READ_PERMS } from "../features/rbac/constants";

export function Nav() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const canAdmin = useCanAny(ADMIN_READ_PERMS);

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
    <nav className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-4 text-sm">
        <Link to="/" className="font-semibold text-slate-800">
          Trello Clone
        </Link>
        <Link to="/settings/password" className="text-slate-600 hover:text-slate-900">
          Settings
        </Link>
        {canAdmin ? (
          <Link to="/admin" className="text-slate-600 hover:text-slate-900">
            Admin
          </Link>
        ) : null}
      </div>
      <div className="flex items-center gap-3 text-sm">
        {user ? <span className="text-slate-500">{user.email}</span> : null}
        <button
          type="button"
          onClick={onLogout}
          disabled={logout.isPending}
          className="rounded bg-slate-800 px-3 py-1.5 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Log out
        </button>
      </div>
    </nav>
  );
}
