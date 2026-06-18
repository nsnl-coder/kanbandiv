import type { Kysely } from "kysely";
import type { Permission } from "shared";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export async function findUserGlobalPerms(
  db: Db,
  userId: string,
): Promise<{ isSuperuser: boolean; perms: Set<Permission> }> {
  const user = await db
    .selectFrom("users")
    .select(["is_superuser", "role_id"])
    .where("id", "=", userId)
    .executeTakeFirst();

  if (!user) return { isSuperuser: false, perms: new Set() };
  if (!user.role_id) return { isSuperuser: user.is_superuser, perms: new Set() };

  const rows = await db
    .selectFrom("role_permissions")
    .select("permission")
    .where("role_id", "=", user.role_id)
    .execute();

  return {
    isSuperuser: user.is_superuser,
    perms: new Set(rows.map((r) => r.permission)),
  };
}

// --- roles ---

export function createRole(
  db: Db,
  input: { name: string; description?: string | null },
) {
  return db
    .insertInto("roles")
    .values({ name: input.name, description: input.description ?? null })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findRoleById(db: Db, id: string) {
  return db
    .selectFrom("roles")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export function findRoleByName(db: Db, name: string) {
  return db
    .selectFrom("roles")
    .selectAll()
    .where("name", "=", name)
    .executeTakeFirst();
}

export function listRoles(db: Db) {
  return db.selectFrom("roles").selectAll().orderBy("name", "asc").execute();
}

export function updateRole(
  db: Db,
  id: string,
  patch: { name?: string; description?: string | null },
) {
  return db
    .updateTable("roles")
    .set({ ...patch, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function deleteRole(db: Db, id: string) {
  return db.deleteFrom("roles").where("id", "=", id).execute();
}

export function findRolePermissions(db: Db, roleId: string) {
  return db
    .selectFrom("role_permissions")
    .select("permission")
    .where("role_id", "=", roleId)
    .execute();
}

export async function setRolePermissions(
  db: Db,
  roleId: string,
  permissions: Permission[],
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await tx
      .deleteFrom("role_permissions")
      .where("role_id", "=", roleId)
      .execute();
    if (permissions.length > 0) {
      await tx
        .insertInto("role_permissions")
        .values(permissions.map((permission) => ({ role_id: roleId, permission })))
        .execute();
    }
  });
}

export async function countRoleMembers(db: Db, roleId: string): Promise<number> {
  const row = await db
    .selectFrom("users")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("role_id", "=", roleId)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

// --- users ---

export function assignUserRole(db: Db, userId: string, roleId: string | null) {
  return db
    .updateTable("users")
    .set({ role_id: roleId, updated_at: new Date() })
    .where("id", "=", userId)
    .execute();
}

export function listUsers(
  db: Db,
  opts: { search?: string; limit: number; offset: number },
) {
  let q = db
    .selectFrom("users")
    .leftJoin("roles", "roles.id", "users.role_id")
    .select([
      "users.id as id",
      "users.email as email",
      "users.email_verified as email_verified",
      "users.is_superuser as is_superuser",
      "users.role_id as role_id",
      "roles.name as role_name",
    ])
    .orderBy("users.created_at", "desc")
    .limit(opts.limit)
    .offset(opts.offset);

  if (opts.search) {
    q = q.where("users.email", "ilike", `%${opts.search}%`);
  }
  return q.execute();
}

export function findAdminUserById(db: Db, userId: string) {
  return db
    .selectFrom("users")
    .leftJoin("roles", "roles.id", "users.role_id")
    .select([
      "users.id as id",
      "users.email as email",
      "users.email_verified as email_verified",
      "users.is_superuser as is_superuser",
      "users.role_id as role_id",
      "roles.name as role_name",
    ])
    .where("users.id", "=", userId)
    .executeTakeFirst();
}
