import { type ReactNode } from "react";
import { Navigate, Outlet, useSearchParams } from "react-router-dom";
import type { AuthRole } from "shared";
import { useAuthStore } from "../hooks/useAuthStore";

const roleHome: Record<AuthRole, string> = { admin: "/admin", user: "/" };

interface GuestRouteProps {
  children?: ReactNode;
}

// Session hydration happens once in App; this guard only reads the store.
export function GuestRoute({ children }: GuestRouteProps) {
  const user = useAuthStore((s) => s.user);
  const [params] = useSearchParams();

  if (user === null) {
    return children ? <>{children}</> : <Outlet />;
  }

  const next = params.get("next");
  return <Navigate to={next ?? roleHome[user.role]} replace />;
}
