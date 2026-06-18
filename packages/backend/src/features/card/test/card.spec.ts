import { BoardError, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authedCaller,
  newTestDb,
  seedBoard,
  seedBoardAccess,
  seedColumn,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "./helpers.js";

async function ownerBoardColumn(db: TestDb, email = "owner@example.com") {
  const { user, caller } = await seedUserCaller(db, email);
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
  const column = await seedColumn(db, { boardId: board.id, position: 1 });
  return { user, caller, project, board, column };
}

describe("cards", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("creates cards at the end of a column", async () => {
    const { caller, column } = await ownerBoardColumn(db);
    const a = await caller.cards.create({ columnId: column.id, title: "A" });
    const b = await caller.cards.create({ columnId: column.id, title: "B" });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it("reorders a card within the same column", async () => {
    const { caller, board, column } = await ownerBoardColumn(db);
    const a = await caller.cards.create({ columnId: column.id, title: "A" });
    const b = await caller.cards.create({ columnId: column.id, title: "B" });
    await caller.cards.move({
      id: b.id,
      toColumnId: column.id,
      beforeId: a.id,
    });
    const data = await caller.boards.getData({ id: board.id });
    expect(data.columns[0].cards.map((c) => c.title)).toEqual(["B", "A"]);
  });

  it("moves a card to another column on the same board", async () => {
    const { caller, board, column } = await ownerBoardColumn(db);
    const col2 = await seedColumn(db, { boardId: board.id, position: 2 });
    const card = await caller.cards.create({ columnId: column.id, title: "A" });
    const res = await caller.cards.move({ id: card.id, toColumnId: col2.id });
    expect(res.columnId).toBe(col2.id);
    const data = await caller.boards.getData({ id: board.id });
    expect(data.columns[0].cards).toHaveLength(0);
    expect(data.columns[1].cards.map((c) => c.title)).toEqual(["A"]);
  });

  it("rejects moving a card to a column on a different board", async () => {
    const { user, caller, column } = await ownerBoardColumn(db);
    const project2 = await seedProject(db, { ownerId: user.id, name: "P2" });
    const board2 = await seedBoard(db, { projectId: project2.id, ownerId: user.id });
    const otherCol = await seedColumn(db, { boardId: board2.id, position: 1 });
    const card = await caller.cards.create({ columnId: column.id, title: "A" });
    await expect(
      caller.cards.move({ id: card.id, toColumnId: otherCol.id }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: BoardError.INVALID_MOVE,
    });
  });

  it("forbids a view-only grantee from creating a card", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    const column = await seedColumn(db, { boardId: board.id, position: 1 });
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
    await expect(
      authedCaller(db, viewer.id).cards.create({ columnId: column.id, title: "X" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns NOT_FOUND for a card under an inaccessible board", async () => {
    const { caller, column } = await ownerBoardColumn(db);
    const card = await caller.cards.create({ columnId: column.id, title: "A" });
    const { caller: stranger } = await seedUserCaller(db, "x@example.com");
    await expect(
      stranger.cards.update({ id: card.id, title: "X" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
