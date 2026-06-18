import { ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authedCaller,
  newTestDb,
  seedBoard,
  seedBoardAccess,
  seedCard,
  seedColumn,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "./helpers.js";

async function ownerBoard(db: TestDb, email = "owner@example.com") {
  const { user, caller } = await seedUserCaller(db, email);
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
  return { user, caller, project, board };
}

describe("columns", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("creates columns at the end (position max+1)", async () => {
    const { caller, board } = await ownerBoard(db);
    const a = await caller.columns.create({ boardId: board.id, name: "A" });
    const b = await caller.columns.create({ boardId: board.id, name: "B" });
    expect(b.position).toBeGreaterThan(a.position);
    const data = await caller.boards.getData({ id: board.id });
    expect(data.columns.map((c) => c.name)).toEqual(["A", "B"]);
  });

  it("moves a column to the start", async () => {
    const { caller, board } = await ownerBoard(db);
    const a = await caller.columns.create({ boardId: board.id, name: "A" });
    const b = await caller.columns.create({ boardId: board.id, name: "B" });
    await caller.columns.move({ id: b.id, beforeId: a.id });
    const data = await caller.boards.getData({ id: board.id });
    expect(data.columns.map((c) => c.name)).toEqual(["B", "A"]);
  });

  it("moves a column to the middle", async () => {
    const { caller, board } = await ownerBoard(db);
    const a = await caller.columns.create({ boardId: board.id, name: "A" });
    const b = await caller.columns.create({ boardId: board.id, name: "B" });
    const c = await caller.columns.create({ boardId: board.id, name: "C" });
    // Move C between A and B.
    await caller.columns.move({ id: c.id, afterId: a.id, beforeId: b.id });
    const data = await caller.boards.getData({ id: board.id });
    expect(data.columns.map((col) => col.name)).toEqual(["A", "C", "B"]);
  });

  it("renames a column", async () => {
    const { caller, board } = await ownerBoard(db);
    const a = await caller.columns.create({ boardId: board.id, name: "A" });
    const res = await caller.columns.update({ id: a.id, name: "Renamed" });
    expect(res.name).toBe("Renamed");
  });

  it("forbids a view-only grantee from creating", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
    await expect(
      authedCaller(db, viewer.id).columns.create({ boardId: board.id, name: "X" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cascades cards when a column is deleted", async () => {
    const { caller, board } = await ownerBoard(db);
    const col = await seedColumn(db, { boardId: board.id, position: 1 });
    const card = await seedCard(db, { columnId: col.id, position: 1 });
    await caller.columns.delete({ id: col.id });
    const row = await db
      .selectFrom("cards")
      .selectAll()
      .where("id", "=", card.id)
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("returns NOT_FOUND for a column on an inaccessible board", async () => {
    const { board } = await ownerBoard(db);
    const col = await seedColumn(db, { boardId: board.id, position: 1 });
    const { caller: stranger } = await seedUserCaller(db, "x@example.com");
    await expect(
      stranger.columns.update({ id: col.id, name: "X" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
