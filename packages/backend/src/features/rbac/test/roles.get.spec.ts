import crypto from "node:crypto";
import { Permission, RbacError } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authzMatrix } from "./authz.js";
import {
  newTestDb,
  seedRole,
  superuserCaller,
  type TestDb,
} from "./helpers.js";

describe("admin.rolesGet", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("returns a role with its permissions", async () => {
    const role = await seedRole(db, {
      name: "Support",
      permissions: [Permission.AdminRolesRead],
    });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.rolesGet({ roleId: role.id });
    expect(res.id).toBe(role.id);
    expect(res.permissions).toEqual([Permission.AdminRolesRead]);
  });

  it("rejects a missing roleId with ROLE_NOT_FOUND", async () => {
    const { caller } = await superuserCaller(db);
    await expect(
      caller.admin.rolesGet({ roleId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: RbacError.ROLE_NOT_FOUND });
  });

  describe("authz", () => {
    authzMatrix(
      () => db,
      Permission.AdminRolesRead,
      (c) => c.admin.rolesGet({ roleId: crypto.randomUUID() }),
    );
  });
});
