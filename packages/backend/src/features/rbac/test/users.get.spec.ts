import crypto from "node:crypto";
import { Permission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authzMatrix } from "./authz.js";
import {
  newTestDb,
  seedRole,
  seedUser,
  superuserCaller,
  type TestDb,
} from "./helpers.js";

describe("admin.usersGet", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("returns an admin user without password_hash", async () => {
    const user = await seedUser(db, { email: "a@example.com" });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.usersGet({ userId: user.id });
    expect(res.id).toBe(user.id);
    expect("password_hash" in res).toBe(false);
  });

  it("populates the role for an assigned user", async () => {
    const role = await seedRole(db, { name: "Team" });
    const user = await seedUser(db, { email: "m@example.com", roleId: role.id });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.usersGet({ userId: user.id });
    expect(res.role).toEqual({ id: role.id, name: "Team" });
  });

  it("rejects a missing userId with NOT_FOUND", async () => {
    const { caller } = await superuserCaller(db);
    await expect(
      caller.admin.usersGet({ userId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  describe("authz", () => {
    authzMatrix(
      () => db,
      Permission.AdminUsersRead,
      (c) => c.admin.usersGet({ userId: crypto.randomUUID() }),
    );
  });
});
