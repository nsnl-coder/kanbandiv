import { z } from "zod";
import {
  adminUserSchema,
  assignGlobalRoleInput,
  createRoleInput,
  listUsersInput,
  okSchema,
  roleSchema,
  updateRoleInput,
  updateRolePermissionsInput,
  Permission,
  type PermissionMeta,
} from "shared";
import { globalProcedure, router } from "../../trpc/trpc.js";
import * as rbac from "./rbac.service.js";

const permissionMetaSchema = z.object({
  key: z.string(),
  label: z.string(),
  scope: z.literal("global").optional(),
});

const roleIdInput = z.object({ roleId: z.string() });
const userIdInput = z.object({ userId: z.string() });

export const rbacRouter = router({
  permissionsList: globalProcedure(Permission.AdminRolesRead)
    .meta({ openapi: { method: "GET", path: "/admin/permissions", tags: ["admin"], protect: true, summary: "List the permission catalog" } })
    .input(z.object({}))
    .output(z.array(permissionMetaSchema))
    .query((): PermissionMeta[] => rbac.listPermissions()),

  rolesList: globalProcedure(Permission.AdminRolesRead)
    .meta({ openapi: { method: "GET", path: "/admin/roles", tags: ["admin"], protect: true, summary: "List roles with permissions and member counts" } })
    .input(z.object({}))
    .output(z.array(roleSchema))
    .query(({ ctx }) => rbac.listRoles(ctx.db)),

  rolesGet: globalProcedure(Permission.AdminRolesRead)
    .meta({ openapi: { method: "GET", path: "/admin/roles/{roleId}", tags: ["admin"], protect: true, summary: "Get a role by id" } })
    .input(roleIdInput)
    .output(roleSchema)
    .query(({ ctx, input }) => rbac.getRole(ctx.db, input.roleId)),

  rolesCreate: globalProcedure(Permission.AdminRolesManage)
    .meta({ openapi: { method: "POST", path: "/admin/roles", tags: ["admin"], protect: true, summary: "Create a role" } })
    .input(createRoleInput)
    .output(roleSchema)
    .mutation(({ ctx, input }) => rbac.createRole(ctx.db, input)),

  rolesUpdate: globalProcedure(Permission.AdminRolesManage)
    .meta({ openapi: { method: "PATCH", path: "/admin/roles/{roleId}", tags: ["admin"], protect: true, summary: "Update a role" } })
    .input(roleIdInput.merge(updateRoleInput))
    .output(roleSchema)
    .mutation(({ ctx, input }) => {
      const { roleId, ...patch } = input;
      return rbac.updateRole(ctx.db, roleId, patch);
    }),

  rolesSetPermissions: globalProcedure(Permission.AdminRolesManage)
    .meta({ openapi: { method: "PUT", path: "/admin/roles/{roleId}/permissions", tags: ["admin"], protect: true, summary: "Replace a role's permissions" } })
    .input(roleIdInput.merge(updateRolePermissionsInput))
    .output(roleSchema)
    .mutation(({ ctx, input }) =>
      rbac.setRolePermissions(ctx.db, input.roleId, { permissions: input.permissions }),
    ),

  rolesDelete: globalProcedure(Permission.AdminRolesManage)
    .meta({ openapi: { method: "DELETE", path: "/admin/roles/{roleId}", tags: ["admin"], protect: true, summary: "Delete a role" } })
    .input(roleIdInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => rbac.deleteRole(ctx.db, input.roleId)),

  usersList: globalProcedure(Permission.AdminUsersRead)
    .meta({ openapi: { method: "GET", path: "/admin/users", tags: ["admin"], protect: true, summary: "List users" } })
    .input(listUsersInput)
    .output(z.array(adminUserSchema))
    .query(({ ctx, input }) => rbac.listUsers(ctx.db, input)),

  usersGet: globalProcedure(Permission.AdminUsersRead)
    .meta({ openapi: { method: "GET", path: "/admin/users/{userId}", tags: ["admin"], protect: true, summary: "Get a user by id" } })
    .input(userIdInput)
    .output(adminUserSchema)
    .query(({ ctx, input }) => rbac.getUser(ctx.db, input.userId)),

  usersAssignRole: globalProcedure(Permission.AdminUsersManage)
    .meta({ openapi: { method: "PUT", path: "/admin/users/{userId}/role", tags: ["admin"], protect: true, summary: "Assign or clear a user's global role" } })
    .input(userIdInput.merge(assignGlobalRoleInput))
    .output(adminUserSchema)
    .mutation(({ ctx, input }) =>
      rbac.assignRole(ctx.db, input.userId, { roleId: input.roleId }),
    ),
});
