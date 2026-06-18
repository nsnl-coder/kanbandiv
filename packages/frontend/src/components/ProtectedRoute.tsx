import { type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { AuthRole } from "shared";
import { useAuthStore } from "../hooks/useAuthStore";

const roleHome: Record<AuthRole, string> = { admin: "/admin", user: "/" };

interface ProtectedRouteProps {
  role?: AuthRole;
  children?: ReactNode;
}

// Session hydration happens once in App (the silent boot refresh). By the time
// a guard renders, the store is settled, so guards only read it.
export function ProtectedRoute({ role, children }: ProtectedRouteProps) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);

  if (user === null) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (role && user.role !== role) {
    return <Navigate to={roleHome[user.role]} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
