import { TRPCError } from "@trpc/server";
import {
  PERMISSION_CATALOG,
  RbacError,
  isPermission,
  type AdminUser,
  type AssignGlobalRoleInput,
  type CreateRoleInput,
  type ListUsersInput,
  type Permission,
  type PermissionMeta,
  type Role,
  type UpdateRoleInput,
  type UpdateRolePermissionsInput,
} from "shared";
import { cache, cacheKeys } from "../../cache/cache.js";
import * as repo from "./rbac.repo.js";
import type { Db } from "./rbac.repo.js";

// Drop cached identity+perms so the next request rebuilds from the DB.
async function invalidateAuthCache(userIds: string[]): Promise<void> {
  if (userIds.length > 0) await cache.del(...userIds.map(cacheKeys.authUser));
}

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
};

type AdminUserRow = {
  id: string;
  email: string;
  email_verified: boolean;
  is_superuser: boolean;
  role_id: string | null;
  role_name: string | null;
};

function roleNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: RbacError.ROLE_NOT_FOUND });
}

function nameTaken() {
  return new TRPCError({ code: "CONFLICT", message: RbacError.ROLE_NAME_TAKEN });
}

function unknownPermission() {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: RbacError.UNKNOWN_PERMISSION,
  });
}

function assertKnownPermissions(permissions: Permission[]): void {
  for (const p of permissions) {
    if (!isPermission(p)) throw unknownPermission();
  }
}

// The actor performing a grant. Permissions come from the request context
// (trpc ctx.user), already resolved fresh from the DB.
export interface RbacActor {
  isSuperuser: boolean;
  permissions: ReadonlySet<Permission>;
}

function cannotGrant() {
  return new TRPCError({
    code: "FORBIDDEN",
    message: RbacError.CANNOT_GRANT_PERMISSION,
  });
}

// Least privilege: a non-superuser may only grant permissions they hold. Blocks
// a roles-manager from minting a role (or assigning one) with perms above them.
function assertCanGrant(
  actor: RbacActor,
  permissions: readonly Permission[],
): void {
  if (actor.isSuperuser) return;
  for (const p of permissions) {
    if (!actor.permissions.has(p)) throw cannotGrant();
  }
}

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    isSuperuser: row.is_superuser,
    role: row.role_id ? { id: row.role_id, name: row.role_name ?? "" } : null,
  };
}

async function toRole(db: Db, row: RoleRow): Promise<Role> {
  const [perms, memberCount] = await Promise.all([
    repo.findRolePermissions(db, row.id),
    repo.countRoleMembers(db, row.id),
  ]);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: perms.map((p) => p.permission),
    memberCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPermissions(): PermissionMeta[] {
  return PERMISSION_CATALOG;
}

export async function listRoles(db: Db): Promise<Role[]> {
  const rows = await repo.listRoles(db);
  return Promise.all(rows.map((r) => toRole(db, r)));
}

export async function getRole(db: Db, roleId: string): Promise<Role> {
  const row = await repo.findRoleById(db, roleId);
  if (!row) throw roleNotFound();
  return toRole(db, row);
}

export async function createRole(
  db: Db,
  actor: RbacActor,
  input: CreateRoleInput,
): Promise<Role> {
  if (input.permissions) {
    assertKnownPermissions(input.permissions);
    assertCanGrant(actor, input.permissions);
  }
  const existing = await repo.findRoleByName(db, input.name);
  if (existing) throw nameTaken();

  const row = await repo.createRole(db, {
    name: input.name,
    description: input.description,
  });
  if (input.permissions && input.permissions.length > 0) {
    await repo.setRolePermissions(db, row.id, input.permissions);
  }
  return toRole(db, row);
}

export async function updateRole(
  db: Db,
  roleId: string,
  input: UpdateRoleInput,
): Promise<Role> {
  const role = await repo.findRoleById(db, roleId);
  if (!role) throw roleNotFound();

  if (input.name && input.name !== role.name) {
    const existing = await repo.findRoleByName(db, input.name);
    if (existing) throw nameTaken();
  }

  const updated = await repo.updateRole(db, roleId, {
    name: input.name,
    description: input.description,
  });
  if (!updated) throw roleNotFound();
  return toRole(db, updated);
}

export async function setRolePermissions(
  db: Db,
  actor: RbacActor,
  roleId: string,
  input: UpdateRolePermissionsInput,
): Promise<Role> {
  assertKnownPermissions(input.permissions);
  assertCanGrant(actor, input.permissions);
  const role = await repo.findRoleById(db, roleId);
  if (!role) throw roleNotFound();
  await repo.setRolePermissions(db, roleId, input.permissions);
  // Perms are role-derived: every holder's cached perms are now stale.
  await invalidateAuthCache(await repo.listUserIdsByRole(db, roleId));
  return toRole(db, role);
}

export async function deleteRole(db: Db, roleId: string): Promise<{ ok: true }> {
  const role = await repo.findRoleById(db, roleId);
  if (!role) throw roleNotFound();
  await repo.deleteRole(db, roleId);
  return { ok: true };
}

export async function listUsers(
  db: Db,
  input: ListUsersInput,
): Promise<AdminUser[]> {
  const rows = await repo.listUsers(db, input);
  return rows.map(toAdminUser);
}

export async function getUser(db: Db, userId: string): Promise<AdminUser> {
  const row = await repo.findAdminUserById(db, userId);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return toAdminUser(row);
}

export async function assignRole(
  db: Db,
  actor: RbacActor,
  userId: string,
  input: AssignGlobalRoleInput,
): Promise<AdminUser> {
  const target = await repo.findAdminUserById(db, userId);
  if (!target) throw new TRPCError({ code: "NOT_FOUND" });
  // The superuser is untouchable: its role cannot be changed via the API.
  if (target.is_superuser) {
    throw new TRPCError({ code: "FORBIDDEN", message: RbacError.FORBIDDEN });
  }
  if (input.roleId) {
    const role = await repo.findRoleById(db, input.roleId);
    if (!role) throw roleNotFound();
    // Assigning a role grants its permissions, so the actor must hold them all.
    const rolePerms = await repo.findRolePermissions(db, input.roleId);
    assertCanGrant(actor, rolePerms.map((p) => p.permission));
  }
  await repo.assignUserRole(db, userId, input.roleId);
  await invalidateAuthCache([userId]);
  const row = await repo.findAdminUserById(db, userId);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return toAdminUser(row);
}
