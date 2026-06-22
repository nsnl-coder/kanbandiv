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

describe("boards.move", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("reorders boards within a project", async () => {
    const { user, caller } = await seedUserCaller(db, "me@example.com");
    const project = await seedProject(db, { ownerId: user.id });
    const x = await seedBoard(db, { projectId: project.id, ownerId: user.id, name: "X" });
    const y = await seedBoard(db, { projectId: project.id, ownerId: user.id, name: "Y" });

    const moved = await caller.boards.move({ id: x.id, afterId: y.id });
    expect(moved.projectId).toBe(project.id);
    expect(moved.position).toBeGreaterThan(y.position);
  });

  it("allows an edit-grantee to reorder within the same project", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const { user, caller } = await seedUserCaller(db, "editor@example.com");
    const project = await seedProject(db, { ownerId: owner.id });
    const x = await seedBoard(db, { projectId: project.id, ownerId: owner.id, name: "X" });
    const y = await seedBoard(db, { projectId: project.id, ownerId: owner.id, name: "Y" });
    await seedBoardAccess(db, x.id, user.id, ProjectPermission.Edit);
    await seedBoardAccess(db, y.id, user.id, ProjectPermission.Edit);

    const moved = await caller.boards.move({ id: x.id, afterId: y.id });
    expect(moved.position).toBeGreaterThan(y.position);
  });

  it("moves a board to another project the owner owns", async () => {
    const { user, caller } = await seedUserCaller(db, "me@example.com");
    const from = await seedProject(db, { ownerId: user.id, name: "From" });
    const to = await seedProject(db, { ownerId: user.id, name: "To" });
    const board = await seedBoard(db, { projectId: from.id, ownerId: user.id });

    const moved = await caller.boards.move({ id: board.id, toProjectId: to.id });
    expect(moved.projectId).toBe(to.id);
  });

  it("rejects a cross-project move by a non-owner of the board", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const { user, caller } = await seedUserCaller(db, "editor@example.com");
    const from = await seedProject(db, { ownerId: owner.id });
    const to = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: from.id, ownerId: owner.id });
    await seedBoardAccess(db, board.id, user.id, ProjectPermission.Edit);

    await expect(
      caller.boards.move({ id: board.id, toProjectId: to.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a cross-project move into a project the caller does not own", async () => {
    const { user, caller } = await seedUserCaller(db, "me@example.com");
    const other = await seedUser(db, { email: "other@example.com", verified: true });
    const from = await seedProject(db, { ownerId: user.id });
    const to = await seedProject(db, { ownerId: other.id });
    const board = await seedBoard(db, { projectId: from.id, ownerId: user.id });

    await expect(
      caller.boards.move({ id: board.id, toProjectId: to.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
