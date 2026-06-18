import crypto from "node:crypto";
import { AuthError, Permission, RbacError } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authedCaller,
  createCaller,
  makeContext,
  newTestDb,
  noPermsCaller,
  seedUser,
  seedUserWithRole,
  superuserCaller,
  type TestDb,
} from "./helpers.js";

// Probe endpoint admin.permissionsList is guarded by admin:roles:read.

describe("protectedProcedure", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("rejects an unauthenticated call with UNAUTHORIZED / SESSION_EXPIRED", async () => {
    const caller = createCaller(makeContext({ db, userId: null }));
    await expect(caller.admin.permissionsList({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: AuthError.SESSION_EXPIRED,
    });
  });

  it("rejects a token user not in DB", async () => {
    const caller = authedCaller(db, crypto.randomUUID());
    await expect(caller.admin.permissionsList({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: AuthError.SESSION_EXPIRED,
    });
  });

  it("rejects an unverified user", async () => {
    const user = await seedUser(db, { email: "unverified@example.com", verified: false });
    const caller = authedCaller(db, user.id);
    await expect(caller.admin.permissionsList({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: AuthError.SESSION_EXPIRED,
    });
  });

  it("injects ctx permissions so a verified role-holder passes the guard", async () => {
    const { user } = await seedUserWithRole(db, {
      email: "reader@example.com",
      permissions: [Permission.AdminRolesRead],
    });
    const caller = authedCaller(db, user.id);
    await expect(caller.admin.permissionsList({})).resolves.toBeDefined();
  });
});

describe("globalProcedure(permission)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("lets a superuser bypass the permission check", async () => {
    const { caller } = await superuserCaller(db);
    await expect(caller.admin.permissionsList({})).resolves.toBeDefined();
  });

  it("allows a user whose role has the required permission", async () => {
    const { user } = await seedUserWithRole(db, {
      email: "has@example.com",
      permissions: [Permission.AdminRolesRead],
    });
    await expect(authedCaller(db, user.id).admin.permissionsList({})).resolves.toBeDefined();
  });

  it("rejects a user whose role lacks the permission with FORBIDDEN", async () => {
    const { user } = await seedUserWithRole(db, {
      email: "lacks@example.com",
      permissions: [Permission.AdminUsersRead],
    });
    await expect(
      authedCaller(db, user.id).admin.permissionsList({}),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: RbacError.FORBIDDEN });
  });

  it("rejects a user with no role with FORBIDDEN", async () => {
    const { caller } = await noPermsCaller(db);
    await expect(caller.admin.permissionsList({})).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: RbacError.FORBIDDEN,
    });
  });
});
