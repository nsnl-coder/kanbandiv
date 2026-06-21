import { ActivityType, type BoardEvent, BoardEventType, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bus } from "../../realtime/realtime.bus.js";
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

const emptyPayload = {
  description: null,
  coverColor: null,
  labelIds: [],
  checklists: [],
};

describe("card templates", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  // ----- create / list / edit / delete -----

  it("creates a template and lists it", async () => {
    const { caller, board } = await ownerBoardColumn(db);
    const created = await caller.cardTemplates.create({
      boardId: board.id,
      name: "Bug",
      payload: emptyPayload,
    });
    expect(created.name).toBe("Bug");
    const list = await caller.cardTemplates.list({ boardId: board.id });
    expect(list.map((t) => t.id)).toEqual([created.id]);
  });

  it("lists templates ordered by created_at", async () => {
    const { caller, board } = await ownerBoardColumn(db);
    const a = await caller.cardTemplates.create({ boardId: board.id, name: "A", payload: emptyPayload });
    const b = await caller.cardTemplates.create({ boardId: board.id, name: "B", payload: emptyPayload });
    const list = await caller.cardTemplates.list({ boardId: board.id });
    expect(list.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("forbids a view-only member from creating", async () => {
    const { board } = await ownerBoardColumn(db);
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
    await expect(
      authedCaller(db, viewer.id).cardTemplates.create({
        boardId: board.id,
        name: "X",
        payload: emptyPayload,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list on a board the caller cannot see is NOT_FOUND", async () => {
    const { board } = await ownerBoardColumn(db);
    const stranger = await seedUser(db, { email: "s@example.com", verified: true });
    await expect(
      authedCaller(db, stranger.id).cardTemplates.list({ boardId: board.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("updates name and normalizes a partial payload to complete", async () => {
    const { caller, board } = await ownerBoardColumn(db);
    const t = await caller.cardTemplates.create({ boardId: board.id, name: "A", payload: emptyPayload });
    const updated = await caller.cardTemplates.update({
      id: t.id,
      name: "A2",
      // partial payload: defaults fill the rest
      payload: { description: "hi" } as any,
    });
    expect(updated.name).toBe("A2");
    expect(updated.payload).toEqual({
      description: "hi",
      coverColor: null,
      labelIds: [],
      checklists: [],
    });
  });

  it("forbids a view-only member from updating", async () => {
    const { caller, board } = await ownerBoardColumn(db);
    const t = await caller.cardTemplates.create({ boardId: board.id, name: "A", payload: emptyPayload });
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
    await expect(
      authedCaller(db, viewer.id).cardTemplates.update({ id: t.id, name: "Z" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("deletes a template", async () => {
    const { caller, board } = await ownerBoardColumn(db);
    const t = await caller.cardTemplates.create({ boardId: board.id, name: "A", payload: emptyPayload });
    const res = await caller.cardTemplates.delete({ id: t.id });
    expect(res).toEqual({ ok: true });
    const list = await caller.cardTemplates.list({ boardId: board.id });
    expect(list).toHaveLength(0);
  });

  it("forbids a view-only member from deleting", async () => {
    const { caller, board } = await ownerBoardColumn(db);
    const t = await caller.cardTemplates.create({ boardId: board.id, name: "A", payload: emptyPayload });
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
    await expect(
      authedCaller(db, viewer.id).cardTemplates.delete({ id: t.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cascades templates away when the board is deleted", async () => {
    const { caller, board } = await ownerBoardColumn(db);
    await caller.cardTemplates.create({ boardId: board.id, name: "A", payload: emptyPayload });
    await db.deleteFrom("boards").where("id", "=", board.id).execute();
    const rows = await db.selectFrom("card_templates").selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  // ----- payload jsonb round-trip -----

  it("stores payload as a parsed jsonb object (stringify round-trip)", async () => {
    const { caller, board } = await ownerBoardColumn(db);
    const payload = {
      description: "d",
      coverColor: "blue" as const,
      labelIds: ["L1"],
      checklists: [{ title: "C", items: ["x", "y"] }],
    };
    const t = await caller.cardTemplates.create({ boardId: board.id, name: "A", payload });
    const row = await db
      .selectFrom("card_templates")
      .selectAll()
      .where("id", "=", t.id)
      .executeTakeFirstOrThrow();
    expect(row.payload).toEqual(payload);
  });

  it("rejects an unknown payload key with BAD_REQUEST and writes nothing", async () => {
    const { caller, board } = await ownerBoardColumn(db);
    await expect(
      caller.cardTemplates.create({
        boardId: board.id,
        name: "A",
        payload: { ...emptyPayload, evil: 1 } as any,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const rows = await db.selectFrom("card_templates").selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  // ----- instantiate -----

  it("instantiates a card at position max+1 with all payload applied", async () => {
    const { caller, board, column } = await ownerBoardColumn(db);
    await caller.cards.create({ columnId: column.id, title: "existing" });
    const label = await caller.labels.create({ boardId: board.id, name: "L", color: "#61bd4f" });
    const t = await caller.cardTemplates.create({
      boardId: board.id,
      name: "Tmpl",
      payload: {
        description: "desc",
        coverColor: "red",
        labelIds: [label.id],
        checklists: [{ title: "Steps", items: ["one", "two"] }],
      },
    });
    const card = await caller.cardTemplates.instantiate({ id: t.id, columnId: column.id });

    expect(card.title).toBe("Tmpl");
    expect(card.description).toBe("desc");
    expect(card.position).toBe(2);
    expect(card.cover).toEqual({ type: "color", color: "red" });
    expect(card.labels.map((l) => l.id)).toEqual([label.id]);
    expect(card.checklistProgress).toEqual({ done: 0, total: 2 });

    const cl = await db
      .selectFrom("card_labels")
      .selectAll()
      .where("card_id", "=", card.id)
      .execute();
    expect(cl.map((r) => r.label_id)).toEqual([label.id]);

    const checklists = await db
      .selectFrom("checklists")
      .selectAll()
      .where("card_id", "=", card.id)
      .execute();
    expect(checklists).toHaveLength(1);
    expect(checklists[0].title).toBe("Steps");
    const items = await db
      .selectFrom("checklist_items")
      .selectAll()
      .where("checklist_id", "=", checklists[0].id)
      .orderBy("position", "asc")
      .execute();
    expect(items.map((i) => i.text)).toEqual(["one", "two"]);
  });

  it("instantiates an empty template as a bare card", async () => {
    const { caller, board, column } = await ownerBoardColumn(db);
    const tmpl = await caller.cardTemplates.create({
      boardId: board.id,
      name: "Bare",
      payload: emptyPayload,
    });
    const card = await caller.cardTemplates.instantiate({ id: tmpl.id, columnId: column.id });
    expect(card.title).toBe("Bare");
    expect(card.description).toBeNull();
    expect(card.cover).toBeNull();
    expect(card.labels).toHaveLength(0);
    expect(card.checklistProgress).toEqual({ done: 0, total: 0 });
  });

  it("skips a stale (deleted) label on instantiate", async () => {
    const { caller, board, column } = await ownerBoardColumn(db);
    const keep = await caller.labels.create({ boardId: board.id, name: "K", color: "#61bd4f" });
    const drop = await caller.labels.create({ boardId: board.id, name: "D", color: "#f2d600" });
    const t = await caller.cardTemplates.create({
      boardId: board.id,
      name: "Tmpl",
      payload: { ...emptyPayload, labelIds: [keep.id, drop.id] },
    });
    await caller.labels.delete({ id: drop.id });
    const card = await caller.cardTemplates.instantiate({ id: t.id, columnId: column.id });
    expect(card.labels.map((l) => l.id)).toEqual([keep.id]);
    const rows = await db
      .selectFrom("card_labels")
      .selectAll()
      .where("card_id", "=", card.id)
      .execute();
    expect(rows.map((r) => r.label_id)).toEqual([keep.id]);
  });

  it("skips a label id from another board on instantiate", async () => {
    const { user, caller, board, column } = await ownerBoardColumn(db);
    const project2 = await seedProject(db, { ownerId: user.id, name: "P2" });
    const board2 = await seedBoard(db, { projectId: project2.id, ownerId: user.id });
    const foreign = await caller.labels.create({ boardId: board2.id, name: "F", color: "#61bd4f" });
    const t = await caller.cardTemplates.create({
      boardId: board.id,
      name: "Tmpl",
      payload: { ...emptyPayload, labelIds: [foreign.id] },
    });
    const card = await caller.cardTemplates.instantiate({ id: t.id, columnId: column.id });
    expect(card.labels).toHaveLength(0);
  });

  it("forbids a view-only member from instantiating and writes no card", async () => {
    const { caller, board, column } = await ownerBoardColumn(db);
    const t = await caller.cardTemplates.create({ boardId: board.id, name: "A", payload: emptyPayload });
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
    await expect(
      authedCaller(db, viewer.id).cardTemplates.instantiate({ id: t.id, columnId: column.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const cards = await db
      .selectFrom("cards")
      .selectAll()
      .where("column_id", "=", column.id)
      .execute();
    expect(cards).toHaveLength(0);
  });

  it("rejects instantiating into a column on a different board (INVALID_TARGET)", async () => {
    const { user, caller, board } = await ownerBoardColumn(db);
    const project2 = await seedProject(db, { ownerId: user.id, name: "P2" });
    const board2 = await seedBoard(db, { projectId: project2.id, ownerId: user.id });
    const col2 = await seedColumn(db, { boardId: board2.id, position: 1 });
    const t = await caller.cardTemplates.create({ boardId: board.id, name: "A", payload: emptyPayload });
    await expect(
      caller.cardTemplates.instantiate({ id: t.id, columnId: col2.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const cards = await db
      .selectFrom("cards")
      .selectAll()
      .where("column_id", "=", col2.id)
      .execute();
    expect(cards).toHaveLength(0);
  });

  it("instantiating a template the caller cannot see is NOT_FOUND", async () => {
    const { caller, board, column } = await ownerBoardColumn(db);
    const t = await caller.cardTemplates.create({ boardId: board.id, name: "A", payload: emptyPayload });
    const stranger = await seedUser(db, { email: "s@example.com", verified: true });
    await expect(
      authedCaller(db, stranger.id).cardTemplates.instantiate({ id: t.id, columnId: column.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a missing columnId with COLUMN_NOT_FOUND", async () => {
    const { caller, board } = await ownerBoardColumn(db);
    const t = await caller.cardTemplates.create({ boardId: board.id, name: "A", payload: emptyPayload });
    await expect(
      caller.cardTemplates.instantiate({ id: t.id, columnId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ----- activity + realtime -----

  it("records exactly one CARD_CREATED activity on instantiate", async () => {
    const { user, caller, board, column } = await ownerBoardColumn(db);
    const label = await caller.labels.create({ boardId: board.id, name: "L", color: "#61bd4f" });
    const t = await caller.cardTemplates.create({
      boardId: board.id,
      name: "Tmpl",
      payload: { ...emptyPayload, labelIds: [label.id], checklists: [{ title: "C", items: ["a"] }] },
    });
    const card = await caller.cardTemplates.instantiate({ id: t.id, columnId: column.id });
    const acts = await db
      .selectFrom("activities")
      .selectAll()
      .where("card_id", "=", card.id)
      .execute();
    expect(acts).toHaveLength(1);
    expect(acts[0].type).toBe(ActivityType.CARD_CREATED);
    expect(acts[0].board_id).toBe(board.id);
    expect(acts[0].actor_id).toBe(user.id);
    expect((acts[0].meta as any).cardTitle).toBe("Tmpl");
  });

  it("publishes exactly one realtime event on instantiate (no double-publish)", async () => {
    const { user, caller, board, column } = await ownerBoardColumn(db);
    const t = await caller.cardTemplates.create({ boardId: board.id, name: "A", payload: emptyPayload });
    const events: BoardEvent[] = [];
    const unsub = bus.subscribe(board.id, (e) => events.push(e));
    try {
      await caller.cardTemplates.instantiate({ id: t.id, columnId: column.id });
    } finally {
      unsub();
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(BoardEventType.CARD_ACTIVITY);
    expect(events[0].boardId).toBe(board.id);
    expect(events[0].actorId).toBe(user.id);
  });
});
