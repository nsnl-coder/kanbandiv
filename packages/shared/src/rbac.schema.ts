import { z } from "zod";

export const Permission = {
  AdminUsersRead: "admin:users:read",
  AdminUsersManage: "admin:users:manage",
  AdminRolesRead: "admin:roles:read",
  AdminRolesManage: "admin:roles:manage",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export interface PermissionMeta {
  key: Permission;
  label: string;
  // scope kept for future project-scoped permissions; "global" for now.
  scope?: "global";
}

export const PERMISSION_CATALOG: PermissionMeta[] = [
  { key: Permission.AdminUsersRead, label: "Read users", scope: "global" },
  { key: Permission.AdminUsersManage, label: "Manage users", scope: "global" },
  { key: Permission.AdminRolesRead, label: "Read roles", scope: "global" },
  { key: Permission.AdminRolesManage, label: "Manage roles", scope: "global" },
];

const PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key) as [
  Permission,
  ...Permission[],
];

export const permissionSchema = z.enum(PERMISSION_KEYS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_KEYS.includes(value as Permission);
}

export function hasPermission(set: Set<Permission>, perm: Permission): boolean {
  return set.has(perm);
}

export const ROLE_NAME_MIN = 1;
export const ROLE_NAME_MAX = 64;

const roleNameSchema = z.string().trim().min(ROLE_NAME_MIN).max(ROLE_NAME_MAX);
const roleDescriptionSchema = z.string().trim().max(500);

export const createRoleInput = z.object({
  name: roleNameSchema,
  description: roleDescriptionSchema.optional(),
  permissions: z.array(permissionSchema).optional(),
});
export type CreateRoleInput = z.infer<typeof createRoleInput>;

export const updateRoleInput = z.object({
  name: roleNameSchema.optional(),
  description: roleDescriptionSchema.nullable().optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleInput>;

export const updateRolePermissionsInput = z.object({
  permissions: z.array(permissionSchema),
});
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsInput>;

export const assignGlobalRoleInput = z.object({
  roleId: z.string().nullable(),
});
export type AssignGlobalRoleInput = z.infer<typeof assignGlobalRoleInput>;

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(permissionSchema),
  memberCount: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Role = z.infer<typeof roleSchema>;

export const adminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  isSuperuser: z.boolean(),
  role: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const listUsersInput = z.object({
  search: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type ListUsersInput = z.infer<typeof listUsersInput>;
