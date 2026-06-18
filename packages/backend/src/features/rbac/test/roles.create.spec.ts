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

describe("admin.rolesCreate", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("creates a role and persists its permissions", async () => {
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.rolesCreate({
      name: "Support",
      description: "Helpers",
      permissions: [Permission.AdminUsersRead],
    });
    expect(res.name).toBe("Support");
    expect(res.permissions).toEqual([Permission.AdminUsersRead]);

    const rows = await db
      .selectFrom("role_permissions")
      .select("permission")
      .where("role_id", "=", res.id)
      .execute();
    expect(rows.map((r) => r.permission)).toEqual([Permission.AdminUsersRead]);
  });

  it("creates a role with an empty permission set", async () => {
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.rolesCreate({ name: "Empty", permissions: [] });
    expect(res.permissions).toEqual([]);
  });

  it("rejects a duplicate name with ROLE_NAME_TAKEN", async () => {
    await seedRole(db, { name: "Support" });
    const { caller } = await superuserCaller(db);
    await expect(
      caller.admin.rolesCreate({ name: "Support" }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: RbacError.ROLE_NAME_TAKEN });
  });

  it("router-level zod rejects an unknown permission with BAD_REQUEST", async () => {
    const { caller } = await superuserCaller(db);
    await expect(
      caller.admin.rolesCreate({
        name: "Bad",
        permissions: ["nope:nope" as Permission],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("service rejects an unknown permission pre-insert and creates no row", async () => {
    // Service guard (assertKnownPermissions) is the defense behind zod.
    await expect(
      rbac.createRole(db, { name: "Bad", permissions: ["nope:nope" as Permission] }),
    ).rejects.toMatchObject({ message: RbacError.UNKNOWN_PERMISSION });
    const rows = await db.selectFrom("roles").select("id").where("name", "=", "Bad").execute();
    expect(rows).toHaveLength(0);
  });

  it("rejects an empty name with BAD_REQUEST", async () => {
    const { caller } = await superuserCaller(db);
    await expect(
      caller.admin.rolesCreate({ name: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  describe("authz", () => {
    authzMatrix(
      () => db,
      Permission.AdminRolesManage,
      (c) => c.admin.rolesCreate({ name: `r-${Math.random()}` }),
    );
  });
});
