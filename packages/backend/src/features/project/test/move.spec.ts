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

describe("projects.move", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("places a project after a neighbour (higher position)", async () => {
    const { user, caller } = await seedUserCaller(db, "me@example.com");
    const a = await seedProject(db, { ownerId: user.id, name: "A" });
    const b = await seedProject(db, { ownerId: user.id, name: "B" });

    const moved = await caller.projects.move({ id: a.id, afterId: b.id });
    expect(moved.position).toBeGreaterThan(b.position);
  });

  it("places a project before a neighbour (lower position)", async () => {
    const { user, caller } = await seedUserCaller(db, "me@example.com");
    const a = await seedProject(db, { ownerId: user.id, name: "A" });
    const b = await seedProject(db, { ownerId: user.id, name: "B" });

    const moved = await caller.projects.move({ id: b.id, beforeId: a.id });
    expect(moved.position).toBeLessThan(a.position);
  });

  it("rejects reordering a project the caller only has edit access to", async () => {
    const { user, caller } = await seedUserCaller(db, "me@example.com");
    const other = await seedUser(db, { email: "other@example.com", verified: true });
    const shared = await seedProject(db, { ownerId: other.id });
    await seedAccess(db, shared.id, user.id, ProjectPermission.Edit);

    await expect(caller.projects.move({ id: shared.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects reordering a project the caller cannot see", async () => {
    const { caller } = await seedUserCaller(db, "me@example.com");
    const other = await seedUser(db, { email: "other@example.com", verified: true });
    const hidden = await seedProject(db, { ownerId: other.id });

    await expect(caller.projects.move({ id: hidden.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
