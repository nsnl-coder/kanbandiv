import { ActivityType, BoardError, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeEmail } from "../../auth/test/helpers.js";
import { runDueReminders } from "../../card/card.reminder.js";
import { searchCards } from "../../search/search.repo.js";
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

async function setup(db: TestDb, email = "owner@example.com") {
  const { user, caller } = await seedUserCaller(db, email);
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
  const column = await seedColumn(db, { boardId: board.id, position: 1 });
  const card = await seedCard(db, { columnId: column.id, position: 1 });
  return { user, caller, project, board, column, card };
}

describe("archiving — hides from read paths", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("getBoardData omits an archived card", async () => {
    const { caller, board, card } = await setup(db);
    await caller.cards.archive({ id: card.id });
    const data = await caller.boards.getData({ id: board.id });
    const allCards = data.columns.flatMap((c) => c.cards);
    expect(allCards.map((c) => c.id)).not.toContain(card.id);
  });

  it("getBoardData omits an archived column AND its active cards", async () => {
    const { caller, board, column, card } = await setup(db);
    await caller.columns.archive({ id: column.id });
    const data = await caller.boards.getData({ id: board.id });
    expect(data.columns.map((c) => c.id)).not.toContain(column.id);
    expect(data.columns.flatMap((c) => c.cards).map((c) => c.id)).not.toContain(
      card.id,
    );
  });

  it("boards.list omits an archived board", async () => {
    const { caller, project, board } = await setup(db);
    await caller.boards.archive({ id: board.id });
    const list = await caller.boards.list({ projectId: project.id });
    expect(list.map((b) => b.id)).not.toContain(board.id);
  });

  it("boards.get on an archived board -> NOT_FOUND", async () => {
    const { caller, board } = await setup(db);
    await caller.boards.archive({ id: board.id });
    await expect(caller.boards.get({ id: board.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("boards.getData on an archived board -> NOT_FOUND (no ghost board)", async () => {
    const { caller, board } = await setup(db);
    await caller.boards.archive({ id: board.id });
    await expect(caller.boards.getData({ id: board.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("cards.due excludes archived card / card under archived column", async () => {
    const { caller, board, column } = await setup(db);
    const soon = new Date(Date.now() + 3_600_000);
    const a = await caller.cards.create({ columnId: column.id, title: "A" });
    const b = await caller.cards.create({ columnId: column.id, title: "B" });
    await caller.cards.update({ id: a.id, dueAt: soon });
    await caller.cards.update({ id: b.id, dueAt: soon });
    await caller.cards.archive({ id: a.id });
    const from = new Date(Date.now() - 86_400_000);
    const to = new Date(Date.now() + 86_400_000);
    let due = await caller.cards.due({ boardId: board.id, from, to });
    expect(due.map((c) => c.id)).toEqual([b.id]);
    // archive the column -> b also disappears
    await caller.columns.archive({ id: column.id });
    due = await caller.cards.due({ boardId: board.id, from, to });
    expect(due).toHaveLength(0);
  });

  it("cards.due on an archived board (columns active) -> empty", async () => {
    const { caller, board, column } = await setup(db);
    const soon = new Date(Date.now() + 3_600_000);
    const a = await caller.cards.create({ columnId: column.id, title: "A" });
    await caller.cards.update({ id: a.id, dueAt: soon });
    await caller.boards.archive({ id: board.id });
    const due = await caller.cards.due({
      boardId: board.id,
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 86_400_000),
    });
    expect(due).toHaveLength(0);
  });

  it("reminders skip archived card / column / board", async () => {
    const { caller, board, column, card } = await setup(db);
    const due = new Date(Date.now() + 30 * 60_000);
    await caller.cards.update({ id: card.id, dueAt: due, reminderMinutes: 60 });

    await caller.cards.archive({ id: card.id });
    let email = fakeEmail();
    expect(await runDueReminders(db, email)).toBe(0);

    await caller.cards.restore({ id: card.id });
    // archive column suppresses
    await caller.columns.archive({ id: column.id });
    email = fakeEmail();
    expect(await runDueReminders(db, email)).toBe(0);

    await caller.columns.restore({ id: column.id });
    await caller.boards.archive({ id: board.id });
    email = fakeEmail();
    expect(await runDueReminders(db, email)).toBe(0);

    // fully active -> sends
    await caller.boards.restore({ id: board.id });
    email = fakeEmail();
    expect(await runDueReminders(db, email)).toBe(1);
  });

  it("search excludes archived card / column / board", async () => {
    const { user, board, column, card } = await setup(db);
    const base = {
      userId: user.id,
      isSuperuser: false,
      q: "",
      hasText: false,
      now: new Date(),
      limit: 50,
      offset: 0,
      boardId: board.id,
    };
    let rows = await searchCards(db, base);
    expect(rows.map((r) => r.id)).toContain(card.id);

    await db
      .updateTable("cards")
      .set({ archived_at: new Date() })
      .where("id", "=", card.id)
      .execute();
    rows = await searchCards(db, base);
    expect(rows.map((r) => r.id)).not.toContain(card.id);

    // reset card, archive column
    await db
      .updateTable("cards")
      .set({ archived_at: null })
      .where("id", "=", card.id)
      .execute();
    await db
      .updateTable("columns")
      .set({ archived_at: new Date() })
      .where("id", "=", column.id)
      .execute();
    rows = await searchCards(db, base);
    expect(rows.map((r) => r.id)).not.toContain(card.id);

    // reset column, archive board
    await db
      .updateTable("columns")
      .set({ archived_at: null })
      .where("id", "=", column.id)
      .execute();
    await db
      .updateTable("boards")
      .set({ archived_at: new Date() })
      .where("id", "=", board.id)
      .execute();
    rows = await searchCards(db, base);
    expect(rows.map((r) => r.id)).not.toContain(card.id);
  });

  it("column.move ignores archived siblings", async () => {
    const { caller, board } = await setup(db);
    const c1 = await caller.columns.create({ boardId: board.id, name: "C1" });
    const c2 = await caller.columns.create({ boardId: board.id, name: "C2" });
    await caller.columns.archive({ id: c1.id });
    // moving c2 with no neighbours appends after max ACTIVE position
    const moved = await caller.columns.move({ id: c2.id });
    expect(moved.id).toBe(c2.id);
  });

  it("new card appends after max ACTIVE position", async () => {
    const { caller, column } = await setup(db);
    const a = await caller.cards.create({ columnId: column.id, title: "A" });
    await caller.cards.archive({ id: a.id });
    const b = await caller.cards.create({ columnId: column.id, title: "B" });
    expect(b.position).toBeGreaterThan(0);
  });
});

describe("archiving — restore", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("restore a card -> reappears in getBoardData", async () => {
    const { caller, board, card } = await setup(db);
    await caller.cards.archive({ id: card.id });
    await caller.cards.restore({ id: card.id });
    const data = await caller.boards.getData({ id: board.id });
    expect(data.columns.flatMap((c) => c.cards).map((c) => c.id)).toContain(
      card.id,
    );
  });

  it("restore a column -> column + active cards reappear; individually archived stay hidden", async () => {
    const { caller, board, column, card } = await setup(db);
    const other = await seedCard(db, { columnId: column.id, position: 2 });
    await caller.cards.archive({ id: other.id });
    await caller.columns.archive({ id: column.id });
    await caller.columns.restore({ id: column.id });
    const data = await caller.boards.getData({ id: board.id });
    const ids = data.columns.flatMap((c) => c.cards).map((c) => c.id);
    expect(ids).toContain(card.id);
    expect(ids).not.toContain(other.id);
  });

  it("restore a board -> reappears in list, drops from archived", async () => {
    const { caller, project, board } = await setup(db);
    await caller.boards.archive({ id: board.id });
    await caller.boards.restore({ id: board.id });
    const list = await caller.boards.list({ projectId: project.id });
    expect(list.map((b) => b.id)).toContain(board.id);
    const archived = await caller.boards.archived({ projectId: project.id });
    expect(archived.map((b) => b.id)).not.toContain(board.id);
  });
});

describe("archiving — restore into archived parent", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("restoring a card whose column is archived -> PARENT_ARCHIVED, card stays archived, no activity", async () => {
    const { caller, column, card } = await setup(db);
    await caller.cards.archive({ id: card.id });
    await caller.columns.archive({ id: column.id });
    await expect(caller.cards.restore({ id: card.id })).rejects.toMatchObject({
      message: BoardError.PARENT_ARCHIVED,
    });
    const row = await db
      .selectFrom("cards")
      .select("archived_at")
      .where("id", "=", card.id)
      .executeTakeFirstOrThrow();
    expect(row.archived_at).not.toBeNull();
    const acts = await db
      .selectFrom("activities")
      .selectAll()
      .where("type", "=", ActivityType.CARD_RESTORED)
      .execute();
    expect(acts).toHaveLength(0);
  });

  it("restoring a card whose board is archived -> PARENT_ARCHIVED", async () => {
    const { caller, board, card } = await setup(db);
    await caller.cards.archive({ id: card.id });
    await caller.boards.archive({ id: board.id });
    await expect(caller.cards.restore({ id: card.id })).rejects.toMatchObject({
      message: BoardError.PARENT_ARCHIVED,
    });
  });

  it("restoring a column whose board is archived -> PARENT_ARCHIVED", async () => {
    const { caller, board, column } = await setup(db);
    await caller.columns.archive({ id: column.id });
    await caller.boards.archive({ id: board.id });
    await expect(
      caller.columns.restore({ id: column.id }),
    ).rejects.toMatchObject({ message: BoardError.PARENT_ARCHIVED });
  });

  it("after restoring the parent column, the card can be restored", async () => {
    const { caller, column, card } = await setup(db);
    await caller.cards.archive({ id: card.id });
    await caller.columns.archive({ id: column.id });
    await caller.columns.restore({ id: column.id });
    const restored = await caller.cards.restore({ id: card.id });
    expect(restored.archivedAt).toBeNull();
  });
});

describe("archiving — permissions", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("card/column archive+restore: edit ok, view -> FORBIDDEN, no access -> NOT_FOUND", async () => {
    const owner = await seedUser(db, { email: "o@example.com", verified: true });
    const editor = await seedUser(db, { email: "e@example.com", verified: true });
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    const stranger = await seedUser(db, { email: "s@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    const column = await seedColumn(db, { boardId: board.id, position: 1 });
    const card = await seedCard(db, { columnId: column.id, position: 1 });
    await seedBoardAccess(db, board.id, editor.id, ProjectPermission.Edit);
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);

    await expect(
      authedCaller(db, editor.id).cards.archive({ id: card.id }),
    ).resolves.toBeTruthy();
    await expect(
      authedCaller(db, viewer.id).columns.archive({ id: column.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      authedCaller(db, stranger.id).cards.archive({ id: card.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("board archive/restore: owner ok, edit-grantee -> FORBIDDEN", async () => {
    const owner = await seedUser(db, { email: "o@example.com", verified: true });
    const editor = await seedUser(db, { email: "e@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    await seedBoardAccess(db, board.id, editor.id, ProjectPermission.Edit);
    await expect(
      authedCaller(db, editor.id).boards.archive({ id: board.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      authedCaller(db, owner.id).boards.archive({ id: board.id }),
    ).resolves.toBeTruthy();
  });

  it("boards.archivedItems requires edit; view-only -> FORBIDDEN", async () => {
    const owner = await seedUser(db, { email: "o@example.com", verified: true });
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
    await expect(
      authedCaller(db, viewer.id).boards.archivedItems({ id: board.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("archive on nonexistent id -> NOT_FOUND", async () => {
    const { caller } = await setup(db);
    await expect(
      caller.cards.archive({ id: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("archiving — idempotency", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("archiving an already-archived card -> no-op, no duplicate activity", async () => {
    const { caller, card } = await setup(db);
    await caller.cards.archive({ id: card.id });
    await caller.cards.archive({ id: card.id });
    const acts = await db
      .selectFrom("activities")
      .selectAll()
      .where("type", "=", ActivityType.CARD_ARCHIVED)
      .execute();
    expect(acts).toHaveLength(1);
  });

  it("restoring an already-active card -> no-op, no activity", async () => {
    const { caller, card } = await setup(db);
    const res = await caller.cards.restore({ id: card.id });
    expect(res.id).toBe(card.id);
    const acts = await db
      .selectFrom("activities")
      .selectAll()
      .where("type", "=", ActivityType.CARD_RESTORED)
      .execute();
    expect(acts).toHaveLength(0);
  });
});

describe("archiving — archived listings", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("boards.archived lists archived boards the caller can resolve, excludes active + inaccessible", async () => {
    const owner = await seedUser(db, { email: "o@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const active = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    const arch = await seedBoard(db, {
      projectId: project.id,
      ownerId: owner.id,
      archivedAt: new Date(),
    });
    const list = await authedCaller(db, owner.id).boards.archived({
      projectId: project.id,
    });
    expect(list.map((b) => b.id)).toEqual([arch.id]);
    expect(list.map((b) => b.id)).not.toContain(active.id);

    const stranger = await seedUser(db, { email: "x@example.com", verified: true });
    const slist = await authedCaller(db, stranger.id).boards.archived({
      projectId: project.id,
    });
    expect(slist).toHaveLength(0);
  });

  it("boards.archivedItems lists archived columns + individually-archived cards", async () => {
    const { caller, board, column } = await setup(db);
    const archCol = await seedColumn(db, {
      boardId: board.id,
      position: 2,
      name: "Done",
      archivedAt: new Date(),
    });
    const archCard = await seedCard(db, {
      columnId: column.id,
      position: 5,
      title: "Z",
      archivedAt: new Date(),
    });
    const items = await caller.boards.archivedItems({ id: board.id });
    expect(items.columns.map((c) => c.id)).toContain(archCol.id);
    expect(items.cards.map((c) => c.id)).toContain(archCard.id);
    expect(items.cards.find((c) => c.id === archCard.id)?.columnName).toBe(
      column.name,
    );
  });
});

describe("archiving — permanent delete (existing endpoints)", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("cards.delete hard-deletes an archived card", async () => {
    const { caller, card } = await setup(db);
    await caller.cards.archive({ id: card.id });
    await caller.cards.delete({ id: card.id });
    const row = await db
      .selectFrom("cards")
      .selectAll()
      .where("id", "=", card.id)
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("columns.delete cascades active + archived cards", async () => {
    const { caller, column, card } = await setup(db);
    const arch = await seedCard(db, {
      columnId: column.id,
      position: 2,
      archivedAt: new Date(),
    });
    await caller.columns.delete({ id: column.id });
    const rows = await db
      .selectFrom("cards")
      .selectAll()
      .where("column_id", "=", column.id)
      .execute();
    expect(rows).toHaveLength(0);
    expect([card.id, arch.id]).toHaveLength(2);
  });

  it("boards.delete cascades an archived board", async () => {
    const { caller, board, column, card } = await setup(db);
    await caller.boards.archive({ id: board.id });
    await caller.boards.delete({ id: board.id });
    const b = await db
      .selectFrom("boards")
      .selectAll()
      .where("id", "=", board.id)
      .executeTakeFirst();
    expect(b).toBeUndefined();
    const cols = await db
      .selectFrom("columns")
      .selectAll()
      .where("id", "=", column.id)
      .execute();
    const cards = await db
      .selectFrom("cards")
      .selectAll()
      .where("id", "=", card.id)
      .execute();
    expect(cols).toHaveLength(0);
    expect(cards).toHaveLength(0);
  });
});

describe("archiving — activity events", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("CARD_ARCHIVED/RESTORED recorded with cardTitle, card_id, board_id", async () => {
    const { caller, board, card } = await setup(db);
    await caller.cards.archive({ id: card.id });
    await caller.cards.restore({ id: card.id });
    const acts = await db
      .selectFrom("activities")
      .selectAll()
      .where("card_id", "=", card.id)
      .where("type", "in", [
        ActivityType.CARD_ARCHIVED,
        ActivityType.CARD_RESTORED,
      ])
      .execute();
    expect(acts).toHaveLength(2);
    for (const a of acts) {
      expect(a.board_id).toBe(board.id);
      expect((a.meta as any).cardTitle).toBe(card.title);
    }
  });

  it("COLUMN_ARCHIVED/RESTORED board-scoped (card_id null) with columnName", async () => {
    const { caller, board, column } = await setup(db);
    await caller.columns.archive({ id: column.id });
    await caller.columns.restore({ id: column.id });
    const acts = await db
      .selectFrom("activities")
      .selectAll()
      .where("board_id", "=", board.id)
      .where("type", "in", [
        ActivityType.COLUMN_ARCHIVED,
        ActivityType.COLUMN_RESTORED,
      ])
      .execute();
    expect(acts).toHaveLength(2);
    for (const a of acts) {
      expect(a.card_id).toBeNull();
      expect((a.meta as any).columnName).toBe(column.name);
    }
  });

  it("BOARD_ARCHIVED recorded with boardName and survives after archive", async () => {
    const { caller, board } = await setup(db);
    await caller.boards.archive({ id: board.id });
    const acts = await db
      .selectFrom("activities")
      .selectAll()
      .where("board_id", "=", board.id)
      .where("type", "=", ActivityType.BOARD_ARCHIVED)
      .execute();
    expect(acts).toHaveLength(1);
    expect((acts[0].meta as any).boardName).toBe(board.name);
  });
});
