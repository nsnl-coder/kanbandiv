import crypto from "node:crypto";
import { Permission, RbacError } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authzMatrix } from "./authz.js";
import {
  newTestDb,
  seedRole,
  seedUser,
  superuserCaller,
  type TestDb,
} from "./helpers.js";

describe("admin.rolesDelete", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("deletes an unassigned role and cascades its permissions", async () => {
    const role = await seedRole(db, {
      name: "Support",
      permissions: [Permission.AdminUsersRead],
    });
    const { caller } = await superuserCaller(db);
    expect(await caller.admin.rolesDelete({ roleId: role.id })).toEqual({ ok: true });

    const roleRows = await db.selectFrom("roles").select("id").where("id", "=", role.id).execute();
    expect(roleRows).toHaveLength(0);
    const permRows = await db
      .selectFrom("role_permissions")
      .select("permission")
      .where("role_id", "=", role.id)
      .execute();
    expect(permRows).toHaveLength(0);
  });

  it("deletes a role assigned to users and nulls their role_id", async () => {
    const role = await seedRole(db, { name: "Team" });
    const user = await seedUser(db, { email: "member@example.com", roleId: role.id });
    const { caller } = await superuserCaller(db);
    await caller.admin.rolesDelete({ roleId: role.id });

    const row = await db
      .selectFrom("users")
      .select(["id", "role_id"])
      .where("id", "=", user.id)
      .executeTakeFirst();
    expect(row?.id).toBe(user.id);
    expect(row?.role_id).toBeNull();
  });

  it("rejects deleting a missing roleId with ROLE_NOT_FOUND", async () => {
    const { caller } = await superuserCaller(db);
    await expect(
      caller.admin.rolesDelete({ roleId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: RbacError.ROLE_NOT_FOUND });
  });

  describe("authz", () => {
    authzMatrix(
      () => db,
      Permission.AdminRolesManage,
      (c) => c.admin.rolesDelete({ roleId: crypto.randomUUID() }),
    );
  });
});
