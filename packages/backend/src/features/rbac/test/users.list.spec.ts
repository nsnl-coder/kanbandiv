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

describe("admin.usersList", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("returns admin users without password_hash", async () => {
    await seedUser(db, { email: "a@example.com" });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.usersList({ limit: 20, offset: 0 });
    expect(res.length).toBeGreaterThan(0);
    for (const u of res) expect("password_hash" in u).toBe(false);
  });

  it("shapes each user and sets role to null when unassigned", async () => {
    const user = await seedUser(db, { email: "norole@example.com" });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.usersList({ limit: 20, offset: 0 });
    const found = res.find((u) => u.id === user.id);
    expect(Object.keys(found ?? {}).sort()).toEqual([
      "email",
      "emailVerified",
      "id",
      "isSuperuser",
      "role",
    ]);
    expect(found?.role).toBeNull();
  });

  it("populates role for an assigned user", async () => {
    const role = await seedRole(db, { name: "Team" });
    const user = await seedUser(db, { email: "m@example.com", roleId: role.id });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.usersList({ limit: 20, offset: 0 });
    expect(res.find((u) => u.id === user.id)?.role).toEqual({
      id: role.id,
      name: "Team",
    });
  });

  it("filters by email search", async () => {
    await seedUser(db, { email: "needle@example.com" });
    await seedUser(db, { email: "haystack@example.com" });
    const { caller } = await superuserCaller(db);
    const res = await caller.admin.usersList({ search: "needle", limit: 20, offset: 0 });
    expect(res.map((u) => u.email)).toEqual(["needle@example.com"]);
  });

  it("respects limit and offset", async () => {
    for (let i = 0; i < 3; i++) await seedUser(db, { email: `u${i}@example.com` });
    const { caller } = await superuserCaller(db);
    const page = await caller.admin.usersList({ limit: 2, offset: 0 });
    expect(page).toHaveLength(2);
  });

  describe("authz", () => {
    authzMatrix(
      () => db,
      Permission.AdminUsersRead,
      (c) => c.admin.usersList({ limit: 20, offset: 0 }),
    );
  });
});
