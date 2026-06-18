import { ProjectPermission, ProjectVisibility } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authedCaller,
  newTestDb,
  seedAccess,
  seedBoard,
  seedBoardAccess,
  seedProject,
  seedUser,
  superuserCaller,
  type TestDb,
} from "./helpers.js";

describe("board permission inheritance", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("inherits project edit as board edit without a board grant", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const editor = await seedUser(db, { email: "e@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    await seedAccess(db, project.id, editor.id, ProjectPermission.Edit);
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    const res = await authedCaller(db, editor.id).boards.update({
      id: board.id,
      name: "Edited",
    });
    expect(res.name).toBe("Edited");
    expect(res.myPermission).toBe("edit");
  });

  it("lets a board grant raise a project view-only user to edit", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const user = await seedUser(db, { email: "u@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    await seedAccess(db, project.id, user.id, ProjectPermission.View);
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    await seedBoardAccess(db, board.id, user.id, ProjectPermission.Edit);
    const res = await authedCaller(db, user.id).boards.update({
      id: board.id,
      name: "Bumped",
    });
    expect(res.name).toBe("Bumped");
  });

  it("grants superuser full access without any grants", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    const { caller } = await superuserCaller(db);
    const res = await caller.boards.delete({ id: board.id });
    expect(res).toEqual({ ok: true });
  });

  it("inherits view on a public project", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const project = await seedProject(db, {
      ownerId: owner.id,
      visibility: ProjectVisibility.Public,
    });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    const stranger = await seedUser(db, { email: "s@example.com", verified: true });
    const res = await authedCaller(db, stranger.id).boards.get({ id: board.id });
    expect(res.myPermission).toBe("view");
  });
});
