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

describe("boards.delete", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("lets the board owner delete", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
    const res = await caller.boards.delete({ id: board.id });
    expect(res).toEqual({ ok: true });
    const row = await db
      .selectFrom("boards")
      .selectAll()
      .where("id", "=", board.id)
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("lets the project owner delete another user's board", async () => {
    const projectOwner = await seedUser(db, {
      email: "po@example.com",
      verified: true,
    });
    const boardOwner = await seedUser(db, { email: "bo@example.com", verified: true });
    const project = await seedProject(db, { ownerId: projectOwner.id });
    const board = await seedBoard(db, {
      projectId: project.id,
      ownerId: boardOwner.id,
    });
    const res = await authedCaller(db, projectOwner.id).boards.delete({
      id: board.id,
    });
    expect(res).toEqual({ ok: true });
  });

  it("forbids an edit-grantee from deleting", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const editor = await seedUser(db, { email: "e@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    await seedBoardAccess(db, board.id, editor.id, ProjectPermission.Edit);
    await expect(
      authedCaller(db, editor.id).boards.delete({ id: board.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
