import { ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authedCaller,
  newTestDb,
  seedAccess,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "./helpers.js";

describe("projects.moveShared", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("reorders the caller's shared list without touching the owner's order", async () => {
    const { user, caller } = await seedUserCaller(db, "me@example.com");
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const a = await seedProject(db, { ownerId: owner.id, name: "A" });
    const b = await seedProject(db, { ownerId: owner.id, name: "B" });
    await seedAccess(db, a.id, user.id, ProjectPermission.View);
    await seedAccess(db, b.id, user.id, ProjectPermission.View);

    const before = await caller.projects.list({ filter: "shared", limit: 20, offset: 0 });
    expect(before.map((p) => p.id)).toEqual([a.id, b.id]);

    // Move A after B.
    await caller.projects.moveShared({ id: a.id, afterId: b.id });

    const after = await caller.projects.list({ filter: "shared", limit: 20, offset: 0 });
    expect(after.map((p) => p.id)).toEqual([b.id, a.id]);

    // The owner's own ordering is unaffected.
    const ownerCaller = authedCaller(db, owner.id);
    const owned = await ownerCaller.projects.list({ filter: "owned", limit: 20, offset: 0 });
    expect(owned.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it("rejects reordering a project the caller has no access to", async () => {
    const { caller } = await seedUserCaller(db, "me@example.com");
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const hidden = await seedProject(db, { ownerId: owner.id });

    await expect(caller.projects.moveShared({ id: hidden.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
