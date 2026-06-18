import { PERMISSION_CATALOG, Permission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authzMatrix } from "./authz.js";
import { newTestDb, superuserCaller, type TestDb } from "./helpers.js";

describe("admin.permissionsList", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("returns the permission catalog", async () => {
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.permissionsList({});
    expect(res).toEqual(PERMISSION_CATALOG);
  });

  describe("authz", () => {
    authzMatrix(
      () => db,
      Permission.AdminRolesRead,
      (c) => c.admin.permissionsList({}),
    );
  });
});
