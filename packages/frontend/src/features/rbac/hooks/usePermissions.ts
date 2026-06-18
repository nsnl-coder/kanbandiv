import { useMemo } from "react";
import type { Permission } from "shared";
import { useAuthStore } from "../../../hooks/useAuthStore";

export interface EffectivePermissions {
  isSuperuser: boolean;
  permissions: Set<Permission>;
}

// Effective global permissions for the current user, derived from the auth
// payload (publicUserSchema carries the resolved permissions). Empty when
// logged out.
export function usePermissions(): EffectivePermissions {
  const user = useAuthStore((s) => s.user);
  return useMemo(
    () => ({
      isSuperuser: user?.isSuperuser ?? false,
      permissions: new Set(user?.permissions ?? []),
    }),
    [user],
  );
}
