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

describe("admin.rolesList", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("returns roles with permissions and member counts", async () => {
    await seedRole(db, {
      name: "Support",
      permissions: [Permission.AdminUsersRead],
    });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.rolesList({});
    const support = res.find((r) => r.name === "Support");
    expect(support?.permissions).toEqual([Permission.AdminUsersRead]);
    expect(support?.memberCount).toBe(0);
  });

  it("returns an empty array when no roles exist", async () => {
    const { caller } = await superuserCaller(db);
    expect(await caller.admin.rolesList({})).toEqual([]);
  });

  it("counts members assigned to a role", async () => {
    const role = await seedRole(db, { name: "Team" });
    await seedUser(db, { email: "m1@example.com", roleId: role.id });
    await seedUser(db, { email: "m2@example.com", roleId: role.id });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.rolesList({});
    expect(res.find((r) => r.id === role.id)?.memberCount).toBe(2);
  });

  describe("authz", () => {
    authzMatrix(
      () => db,
      Permission.AdminRolesRead,
      (c) => c.admin.rolesList({}),
    );
  });
});
