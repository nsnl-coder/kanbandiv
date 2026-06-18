import { hasPermission, type PublicUser } from "shared";
import { ADMIN_READ_PERMS } from "./constants";

// Where to send a user right after authenticating: the admin area if they have
// any admin access, otherwise the app home.
export function homeFor(user: PublicUser): string {
  const set = new Set(user.permissions);
  const isAdmin =
    user.isSuperuser || ADMIN_READ_PERMS.some((p) => hasPermission(set, p));
  return isAdmin ? "/admin" : "/";
}
