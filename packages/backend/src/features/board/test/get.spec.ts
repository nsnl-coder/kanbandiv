import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newTestDb,
  seedBoard,
  seedCard,
  seedColumn,
  seedProject,
  seedUserCaller,
  type TestDb,
} from "./helpers.js";

describe("boards.get / boards.getData", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("gets a single board", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
    const res = await caller.boards.get({ id: board.id });
    expect(res.id).toBe(board.id);
    expect(res.myPermission).toBe("owner");
  });

  it("returns nested columns and cards ordered by position", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
    const c1 = await seedColumn(db, { boardId: board.id, name: "Todo", position: 1 });
    const c2 = await seedColumn(db, { boardId: board.id, name: "Done", position: 2 });
    await seedCard(db, { columnId: c1.id, title: "B", position: 2 });
    await seedCard(db, { columnId: c1.id, title: "A", position: 1 });
    await seedCard(db, { columnId: c2.id, title: "C", position: 1 });

    const res = await caller.boards.getData({ id: board.id });
    expect(res.columns.map((c) => c.name)).toEqual(["Todo", "Done"]);
    expect(res.columns[0].cards.map((c) => c.title)).toEqual(["A", "B"]);
    expect(res.columns[1].cards.map((c) => c.title)).toEqual(["C"]);
  });

  it("returns NOT_FOUND for a board the caller cannot view", async () => {
    const { user } = await seedUserCaller(db, "owner@example.com");
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
    const { caller: stranger } = await seedUserCaller(db, "x@example.com");
    await expect(stranger.boards.get({ id: board.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
