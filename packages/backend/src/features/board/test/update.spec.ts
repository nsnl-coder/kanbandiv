import { ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authedCaller,
  newTestDb,
  seedBoard,
  seedBoardAccess,
  seedProject,
  seedUser,
  type TestDb,
} from "./helpers.js";

describe("boards.update", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("lets an edit-grantee rename a board", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const editor = await seedUser(db, { email: "e@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    await seedBoardAccess(db, board.id, editor.id, ProjectPermission.Edit);
    const res = await authedCaller(db, editor.id).boards.update({
      id: board.id,
      name: "Renamed",
    });
    expect(res.name).toBe("Renamed");
  });

  it("forbids a view-only grantee from updating", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
    await expect(
      authedCaller(db, viewer.id).boards.update({ id: board.id, name: "X" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
