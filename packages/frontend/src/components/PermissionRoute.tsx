import { type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Permission } from "shared";
import { useAuthStore } from "../hooks/useAuthStore";
import { useCan, useCanAny } from "../features/rbac/hooks/useCan";

interface PermissionRouteProps {
  // Single permission to require. Omit for "any authenticated user".
  perm?: Permission;
  // Require any one of these permissions (used for the admin area root).
  anyOf?: Permission[];
  // Require super-admin (used for ops-only sections like Monitor).
  superuser?: boolean;
  children?: ReactNode;
}

// Session hydration happens once in App (the silent boot refresh). By the time
// a guard renders, the store is settled, so guards only read it.
export function PermissionRoute({ perm, anyOf, superuser, children }: PermissionRouteProps) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const canPerm = useCan(perm ?? ("" as Permission));
  const canAny = useCanAny(anyOf ?? []);

  if (user === null) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  const allowed = superuser
    ? (user.isSuperuser ?? false)
    : perm
      ? canPerm
      : anyOf
        ? canAny
        : true;
  if (!allowed) return <Navigate to="/" replace />;

  return children ? <>{children}</> : <Outlet />;
}
