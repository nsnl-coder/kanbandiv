import { Permission } from "shared";

// Holding any of these grants entry to the admin area (and the Admin nav link).
export const ADMIN_READ_PERMS: Permission[] = [
  Permission.AdminRolesRead,
  Permission.AdminUsersRead,
];
