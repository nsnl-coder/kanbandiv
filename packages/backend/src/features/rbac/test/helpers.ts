import type { Permission } from "shared";
import {
  createCaller,
  makeContext,
  newTestDb,
  seedUser,
  type TestDb,
} from "../../auth/test/helpers.js";

export {
  createCaller,
  makeContext,
  newTestDb,
  seedUser,
  type TestDb,
} from "../../auth/test/helpers.js";

export type AppCaller = ReturnType<typeof createCaller>;

export interface SeedRoleOpts {
  name: string;
  description?: string | null;
  permissions?: Permission[];
}

/** Insert a role plus its role_permissions; returns the role row. */
export async function seedRole(db: TestDb, opts: SeedRoleOpts) {
  const role = await db
    .insertInto("roles")
    .values({ name: opts.name, description: opts.description ?? null })
    .returningAll()
    .executeTakeFirstOrThrow();
  if (opts.permissions && opts.permissions.length > 0) {
    await db
      .insertInto("role_permissions")
      .values(opts.permissions.map((permission) => ({ role_id: role.id, permission })))
      .execute();
  }
  return role;
}

/** Create a role with the given permissions and a verified user assigned to it. */
export async function seedUserWithRole(
  db: TestDb,
  opts: { email: string; permissions: Permission[] },
) {
  const role = await seedRole(db, {
    name: `role-${opts.email}`,
    permissions: opts.permissions,
  });
  const user = await seedUser(db, {
    email: opts.email,
    verified: true,
    roleId: role.id,
  });
  return { user, role };
}

/** Authenticated caller for a given user id (auth via ctx.userId). */
export function authedCaller(db: TestDb, userId: string) {
  return createCaller(makeContext({ db, userId }));
}

/** Seed the single allowed superuser and return its authed caller. */
export async function superuserCaller(db: TestDb, email = "root@example.com") {
  const su = await seedUser(db, { email, isSuperuser: true, verified: true });
  return { caller: authedCaller(db, su.id), user: su };
}

/** Seed a verified user with no role and return its authed caller. */
export async function noPermsCaller(db: TestDb, email = "noperms@example.com") {
  const user = await seedUser(db, { email, verified: true });
  return { caller: authedCaller(db, user.id), user };
}
