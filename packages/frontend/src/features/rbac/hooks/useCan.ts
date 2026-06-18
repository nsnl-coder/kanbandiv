import { hasPermission, type Permission } from "shared";
import { usePermissions } from "./usePermissions";

// True if the user holds `perm`. Superusers bypass the check.
export function useCan(perm: Permission): boolean {
  const { isSuperuser, permissions } = usePermissions();
  return isSuperuser || hasPermission(permissions, perm);
}

// True if the user holds any of `perms` (or is superuser). Used to gate the
// admin area / nav link on "any admin:*:read".
export function useCanAny(perms: Permission[]): boolean {
  const { isSuperuser, permissions } = usePermissions();
  return isSuperuser || perms.some((p) => hasPermission(permissions, p));
}
