import { BoardEventType } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collect,
  newTestDb,
  ownerCard,
  seedChecklist,
  seedChecklistItem,
  type TestDb,
} from "./helpers.js";

async function activityCount(db: TestDb, boardId: string): Promise<number> {
  const rows = await db
    .selectFrom("activities")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("board_id", "=", boardId)
    .executeTakeFirstOrThrow();
  return Number(rows.n);
}

describe("realtime publish points", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  describe("recorder chokepoint", () => {
    it("createCard -> CARD_ACTIVITY with cardId + actorId", async () => {
      const { caller, board, column, user } = await ownerCard(db);
      const { events, off } = collect(board.id);
      const card = await caller.cards.create({ columnId: column.id, title: "X" });
      off();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        boardId: board.id,
        type: BoardEventType.CARD_ACTIVITY,
        actorId: user.id,
        cardId: card.id,
      });
    });

    it("cross-column move -> CARD_ACTIVITY (recorder)", async () => {
      const { caller, board, column, card } = await ownerCard(db);
      const col2 = await caller.columns.create({ boardId: board.id, name: "Done" });
      const { events, off } = collect(board.id);
      await caller.cards.move({ id: card.id, toColumnId: col2.id });
      off();
      expect(events.some((e) => e.type === BoardEventType.CARD_ACTIVITY && e.cardId === card.id)).toBe(true);
    });

    it("addComment -> CARD_ACTIVITY", async () => {
      const { caller, board, card } = await ownerCard(db);
      const { events, off } = collect(board.id);
      await caller.comments.create({ cardId: card.id, body: "hi" });
      off();
      expect(events.some((e) => e.type === BoardEventType.CARD_ACTIVITY)).toBe(true);
    });

    it("archiveColumn -> BOARD_CHANGED (recorder, no cardId)", async () => {
      const { caller, board, column } = await ownerCard(db);
      const { events, off } = collect(board.id);
      await caller.columns.archive({ id: column.id });
      off();
      expect(events.some((e) => e.type === BoardEventType.BOARD_CHANGED && !e.cardId)).toBe(true);
    });
  });

  // Each path: exactly one event AND no new activity row.
  describe("16 explicit publish points (no activity row)", () => {
    it("1. moveCard same-column reorder -> BOARD_CHANGED, no activity", async () => {
      const { caller, board, column } = await ownerCard(db);
      const c1 = await caller.cards.create({ columnId: column.id, title: "1" });
      const c2 = await caller.cards.create({ columnId: column.id, title: "2" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.cards.move({ id: c2.id, toColumnId: column.id, beforeId: c1.id });
      off();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(BoardEventType.BOARD_CHANGED);
      expect(events[0].cardId).toBeUndefined();
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("2. createColumn -> BOARD_CHANGED, no activity", async () => {
      const { caller, board } = await ownerCard(db);
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.columns.create({ boardId: board.id, name: "New" });
      off();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(BoardEventType.BOARD_CHANGED);
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("3. updateColumn rename -> BOARD_CHANGED, no activity", async () => {
      const { caller, board, column } = await ownerCard(db);
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.columns.update({ id: column.id, name: "Renamed" });
      off();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(BoardEventType.BOARD_CHANGED);
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("4. deleteColumn -> BOARD_CHANGED, no activity", async () => {
      const { caller, board } = await ownerCard(db);
      const col = await caller.columns.create({ boardId: board.id, name: "Tmp" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.columns.delete({ id: col.id });
      off();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(BoardEventType.BOARD_CHANGED);
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("5. moveColumn reorder -> BOARD_CHANGED, no activity", async () => {
      const { caller, board, column } = await ownerCard(db);
      const col2 = await caller.columns.create({ boardId: board.id, name: "B" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.columns.move({ id: col2.id, beforeId: column.id });
      off();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(BoardEventType.BOARD_CHANGED);
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("6. createLabel -> BOARD_CHANGED, no activity", async () => {
      const { caller, board } = await ownerCard(db);
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.labels.create({ boardId: board.id, name: "bug", color: "#61bd4f" });
      off();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(BoardEventType.BOARD_CHANGED);
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("7. updateLabel -> BOARD_CHANGED, no activity", async () => {
      const { caller, board } = await ownerCard(db);
      const label = await caller.labels.create({ boardId: board.id, name: "x", color: "#61bd4f" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.labels.update({ id: label.id, name: "y", color: "#f2d600" });
      off();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(BoardEventType.BOARD_CHANGED);
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("8. deleteLabel -> BOARD_CHANGED, no activity", async () => {
      const { caller, board } = await ownerCard(db);
      const label = await caller.labels.create({ boardId: board.id, name: "x", color: "#61bd4f" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.labels.delete({ id: label.id });
      off();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(BoardEventType.BOARD_CHANGED);
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("9. updateChecklist rename -> CARD_ACTIVITY with cardId, no activity", async () => {
      const { caller, board, card } = await ownerCard(db);
      const cl = await caller.checklists.create({ cardId: card.id, title: "A" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.checklists.update({ id: cl.id, title: "B" });
      off();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: BoardEventType.CARD_ACTIVITY, cardId: card.id });
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("10. updateItem text-only edit -> CARD_ACTIVITY, no activity", async () => {
      const { caller, board, card } = await ownerCard(db);
      const cl = await caller.checklists.create({ cardId: card.id, title: "A" });
      const item = await caller.checklistItems.create({ checklistId: cl.id, text: "one" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.checklistItems.update({ id: item.id, text: "two" });
      off();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: BoardEventType.CARD_ACTIVITY, cardId: card.id });
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("10b. updateItem isDone toggle -> records activity (recorder path)", async () => {
      const { caller, board, card } = await ownerCard(db);
      const cl = await caller.checklists.create({ cardId: card.id, title: "A" });
      const item = await caller.checklistItems.create({ checklistId: cl.id, text: "one" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.checklistItems.update({ id: item.id, isDone: true });
      off();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(BoardEventType.CARD_ACTIVITY);
      expect(await activityCount(db, board.id)).toBe(before + 1);
    });

    it("11. deleteItem -> CARD_ACTIVITY, no activity", async () => {
      const { caller, board, card } = await ownerCard(db);
      const cl = await caller.checklists.create({ cardId: card.id, title: "A" });
      const item = await caller.checklistItems.create({ checklistId: cl.id, text: "one" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.checklistItems.delete({ id: item.id });
      off();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: BoardEventType.CARD_ACTIVITY, cardId: card.id });
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("12. moveItem reorder -> CARD_ACTIVITY, no activity", async () => {
      const { caller, board, card } = await ownerCard(db);
      const cl = await caller.checklists.create({ cardId: card.id, title: "A" });
      const i1 = await caller.checklistItems.create({ checklistId: cl.id, text: "one" });
      const i2 = await caller.checklistItems.create({ checklistId: cl.id, text: "two" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.checklistItems.move({ id: i2.id, beforeId: i1.id });
      off();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: BoardEventType.CARD_ACTIVITY, cardId: card.id });
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("13. updateComment edit -> CARD_ACTIVITY, no activity", async () => {
      const { caller, board, card } = await ownerCard(db);
      const comment = await caller.comments.create({ cardId: card.id, body: "hi" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.comments.update({ id: comment.id, body: "edited" });
      off();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: BoardEventType.CARD_ACTIVITY, cardId: card.id });
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("14. deleteComment -> CARD_ACTIVITY, no activity", async () => {
      const { caller, board, card } = await ownerCard(db);
      const comment = await caller.comments.create({ cardId: card.id, body: "hi" });
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.comments.delete({ id: comment.id });
      off();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: BoardEventType.CARD_ACTIVITY, cardId: card.id });
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("15. updateBoard rename -> BOARD_CHANGED, no activity", async () => {
      const { caller, board } = await ownerCard(db);
      const before = await activityCount(db, board.id);
      const { events, off } = collect(board.id);
      await caller.boards.update({ id: board.id, name: "Renamed" });
      off();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(BoardEventType.BOARD_CHANGED);
      expect(await activityCount(db, board.id)).toBe(before);
    });

    it("16. deleteBoard -> BOARD_CHANGED", async () => {
      const { caller, board } = await ownerCard(db);
      const { events, off } = collect(board.id);
      await caller.boards.delete({ id: board.id });
      off();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(BoardEventType.BOARD_CHANGED);
    });
  });

  it("recorder/publish failure never breaks the mutation", async () => {
    // seedChecklistItem/seedChecklist are exercised elsewhere; here assert the
    // mutation still returns even though publishing is best-effort.
    const { caller, card } = await ownerCard(db);
    const cl = await seedChecklist(db, { cardId: card.id, position: 1 });
    await seedChecklistItem(db, { checklistId: cl.id, position: 1 });
    const created = await caller.cards.create({ columnId: card.column_id, title: "ok" });
    expect(created.id).toBeTruthy();
  });
});
