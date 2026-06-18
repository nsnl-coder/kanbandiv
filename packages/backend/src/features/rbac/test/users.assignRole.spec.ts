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

describe("admin.usersAssignRole", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const roleIdOf = (userId: string) =>
    db
      .selectFrom("users")
      .select("role_id")
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();

  it("assigns a role and returns the populated user role", async () => {
    const role = await seedRole(db, { name: "Team" });
    const user = await seedUser(db, { email: "u@example.com" });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.usersAssignRole({ userId: user.id, roleId: role.id });
    expect(res.role).toEqual({ id: role.id, name: "Team" });
    expect((await roleIdOf(user.id)).role_id).toBe(role.id);
  });

  it("clears the role when given roleId null", async () => {
    const role = await seedRole(db, { name: "Team" });
    const user = await seedUser(db, { email: "u@example.com", roleId: role.id });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.usersAssignRole({ userId: user.id, roleId: null });
    expect(res.role).toBeNull();
    expect((await roleIdOf(user.id)).role_id).toBeNull();
  });

  it("rejects a non-existent role and leaves the user unchanged", async () => {
    const user = await seedUser(db, { email: "u@example.com" });
    const { caller } = await superuserCaller(db);
    await expect(
      caller.admin.usersAssignRole({ userId: user.id, roleId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: RbacError.ROLE_NOT_FOUND });
    expect((await roleIdOf(user.id)).role_id).toBeNull();
  });

  it("overwrites an existing role with a single role_id", async () => {
    const r1 = await seedRole(db, { name: "First" });
    const r2 = await seedRole(db, { name: "Second" });
    const user = await seedUser(db, { email: "u@example.com", roleId: r1.id });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.usersAssignRole({ userId: user.id, roleId: r2.id });
    expect(res.role?.id).toBe(r2.id);
    expect((await roleIdOf(user.id)).role_id).toBe(r2.id);
  });

  it("does not flip is_superuser when assigning a role", async () => {
    const role = await seedRole(db, { name: "Team" });
    const user = await seedUser(db, { email: "u@example.com" });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.usersAssignRole({ userId: user.id, roleId: role.id });
    expect(res.isSuperuser).toBe(false);
  });

  describe("authz", () => {
    authzMatrix(
      () => db,
      Permission.AdminUsersManage,
      (c) => c.admin.usersAssignRole({ userId: crypto.randomUUID(), roleId: null }),
    );
  });
});
