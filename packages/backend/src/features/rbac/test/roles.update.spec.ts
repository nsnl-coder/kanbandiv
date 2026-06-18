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

describe("admin.rolesUpdate", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("renames and changes description, bumping updated_at", async () => {
    const role = await seedRole(db, { name: "Old", description: "before" });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.rolesUpdate({
      roleId: role.id,
      name: "New",
      description: "after",
    });
    expect(res.name).toBe("New");
    expect(res.description).toBe("after");
    expect(res.updatedAt.getTime()).toBeGreaterThanOrEqual(role.updated_at.getTime());
  });

  it("rejects a missing roleId with ROLE_NOT_FOUND", async () => {
    const { caller } = await superuserCaller(db);
    await expect(
      caller.admin.rolesUpdate({ roleId: crypto.randomUUID(), name: "X" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: RbacError.ROLE_NOT_FOUND });
  });

  it("rejects renaming to a name owned by another role", async () => {
    await seedRole(db, { name: "Taken" });
    const role = await seedRole(db, { name: "Mine" });
    const { caller } = await superuserCaller(db);
    await expect(
      caller.admin.rolesUpdate({ roleId: role.id, name: "Taken" }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: RbacError.ROLE_NAME_TAKEN });
  });

  it("allows renaming a role to its own current name", async () => {
    const role = await seedRole(db, { name: "Same" });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.rolesUpdate({ roleId: role.id, name: "Same" });
    expect(res.name).toBe("Same");
  });

  describe("authz", () => {
    authzMatrix(
      () => db,
      Permission.AdminRolesManage,
      (c) => c.admin.rolesUpdate({ roleId: crypto.randomUUID(), name: "X" }),
    );
  });
});
