import crypto from "node:crypto";
import { Permission, RbacError } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as rbac from "../rbac.service.js";
import { authzMatrix } from "./authz.js";
import {
  newTestDb,
  seedRole,
  superuserCaller,
  type TestDb,
} from "./helpers.js";

describe("admin.rolesSetPermissions", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const perms = (roleId: string) =>
    db
      .selectFrom("role_permissions")
      .select("permission")
      .where("role_id", "=", roleId)
      .execute();

  it("replaces the permission set and drops old rows", async () => {
    const role = await seedRole(db, {
      name: "Support",
      permissions: [Permission.AdminUsersRead],
    });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.rolesSetPermissions({
      roleId: role.id,
      permissions: [Permission.AdminRolesRead, Permission.AdminRolesManage],
    });
    expect(res.permissions.sort()).toEqual(
      [Permission.AdminRolesRead, Permission.AdminRolesManage].sort(),
    );
    const after = (await perms(role.id)).map((p) => p.permission);
    expect(after).not.toContain(Permission.AdminUsersRead);
  });

  it("clears all permissions when given an empty array", async () => {
    const role = await seedRole(db, {
      name: "Support",
      permissions: [Permission.AdminUsersRead],
    });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.rolesSetPermissions({
      roleId: role.id,
      permissions: [],
    });
    expect(res.permissions).toEqual([]);
    expect(await perms(role.id)).toHaveLength(0);
  });

  it("service rejects an unknown permission and leaves existing rows intact", async () => {
    const role = await seedRole(db, {
      name: "Support",
      permissions: [Permission.AdminUsersRead],
    });
    await expect(
      rbac.setRolePermissions(db, role.id, {
        permissions: ["nope:nope" as Permission],
      }),
    ).rejects.toMatchObject({ message: RbacError.UNKNOWN_PERMISSION });
    expect((await perms(role.id)).map((p) => p.permission)).toEqual([
      Permission.AdminUsersRead,
    ]);
  });

  it("rejects a missing roleId with ROLE_NOT_FOUND", async () => {
    const { caller } = await superuserCaller(db);
    await expect(
      caller.admin.rolesSetPermissions({
        roleId: crypto.randomUUID(),
        permissions: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: RbacError.ROLE_NOT_FOUND });
  });

  it("is idempotent: setting the same set twice keeps no duplicate rows", async () => {
    const role = await seedRole(db, { name: "Support" });
    const { caller } = await superuserCaller(db);
    const set = { roleId: role.id, permissions: [Permission.AdminRolesRead] };
    await caller.admin.rolesSetPermissions(set);
    await caller.admin.rolesSetPermissions(set);
    expect(await perms(role.id)).toHaveLength(1);
  });

  describe("authz", () => {
    authzMatrix(
      () => db,
      Permission.AdminRolesManage,
      (c) =>
        c.admin.rolesSetPermissions({
          roleId: crypto.randomUUID(),
          permissions: [],
        }),
    );
  });
});
