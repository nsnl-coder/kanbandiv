import { ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authedCaller,
  newTestDb,
  seedBoard,
  seedBoardAccess,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "./helpers.js";

describe("boards.list", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("returns boards in a project the caller can view", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const project = await seedProject(db, { ownerId: user.id });
    await seedBoard(db, { projectId: project.id, ownerId: user.id, name: "A" });
    await seedBoard(db, { projectId: project.id, ownerId: user.id, name: "B" });
    const res = await caller.boards.list({ projectId: project.id });
    expect(res).toHaveLength(2);
    expect(res.map((b) => b.name).sort()).toEqual(["A", "B"]);
  });

  it("excludes boards the caller cannot access", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    // Viewer has a board grant on one board only; no project access.
    const shared = await seedBoard(db, {
      projectId: project.id,
      ownerId: owner.id,
      name: "Shared",
    });
    await seedBoard(db, { projectId: project.id, ownerId: owner.id, name: "Hidden" });
    await seedBoardAccess(db, shared.id, viewer.id, ProjectPermission.View);
    const res = await authedCaller(db, viewer.id).boards.list({
      projectId: project.id,
    });
    expect(res.map((b) => b.name)).toEqual(["Shared"]);
  });
});
