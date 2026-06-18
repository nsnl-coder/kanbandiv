import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newTestDb, seedUser, type TestDb } from "../../auth/test/helpers.js";
import * as rbac from "../rbac.service.js";

describe("super admin invariant", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("rejects a second superuser at the DB level", async () => {
    await seedUser(db, { email: "root@example.com", isSuperuser: true });
    await expect(
      seedUser(db, { email: "root2@example.com", isSuperuser: true }),
    ).rejects.toThrow();
  });

  it("allows many non-superusers", async () => {
    await seedUser(db, { email: "a@example.com" });
    await seedUser(db, { email: "b@example.com" });
    await seedUser(db, { email: "root@example.com", isSuperuser: true });
  });

  it("refuses to change a superuser's role via assignRole", async () => {
    const su = await seedUser(db, { email: "root@example.com", isSuperuser: true });
    const role = await rbac.createRole(db, { name: "Support" });
    await expect(
      rbac.assignRole(db, su.id, { roleId: role.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("assigns a role to a normal user", async () => {
    const user = await seedUser(db, { email: "user@example.com" });
    const role = await rbac.createRole(db, { name: "Support" });
    const res = await rbac.assignRole(db, user.id, { roleId: role.id });
    expect(res.role?.id).toBe(role.id);
  });
});
