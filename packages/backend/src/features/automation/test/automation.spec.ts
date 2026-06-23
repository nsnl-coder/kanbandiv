import { AutomationError, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authedCaller,
  newTestDb,
  seedBoardAccess,
  seedCard,
  seedColumn,
  seedOwnerBoard,
  seedUser,
  type TestDb,
} from "../../board/test/helpers.js";
import { runDueApproaching } from "../automation.engine.js";

async function assigneesOf(db: TestDb, cardId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("card_assignees")
    .select(["user_id"])
    .where("card_id", "=", cardId)
    .execute();
  return rows.map((r) => r.user_id);
}

describe("automations", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  describe("CRUD", () => {
    it("create then list returns the rule", async () => {
      const { caller, board } = await seedOwnerBoard(db);
      const rule = await caller.automations.create({
        boardId: board.id,
        name: "Assign on done",
        trigger: { type: "card.moved", toColumnName: "Done" },
        actions: [{ type: "set_due", inDays: 1 }],
      });
      expect(rule.name).toBe("Assign on done");
      expect(rule.enabled).toBe(true);
      const list = await caller.automations.list({ boardId: board.id });
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(rule.id);
    });

    it("update toggles enabled; delete removes", async () => {
      const { caller, board } = await seedOwnerBoard(db);
      const rule = await caller.automations.create({
        boardId: board.id,
        name: "r",
        trigger: { type: "checklist.completed" },
        actions: [{ type: "check_all_items" }],
      });
      const upd = await caller.automations.update({ id: rule.id, enabled: false });
      expect(upd.enabled).toBe(false);
      await caller.automations.delete({ id: rule.id });
      expect(await caller.automations.list({ boardId: board.id })).toHaveLength(0);
    });

    it("create on an inaccessible board -> BOARD_NOT_FOUND", async () => {
      const { board } = await seedOwnerBoard(db);
      const stranger = await seedUser(db, { email: "stranger@example.com" });
      const strangerCaller = authedCaller(db, stranger.id);
      await expect(
        strangerCaller.automations.create({
          boardId: board.id,
          name: "x",
          trigger: { type: "card.moved", toColumnName: null },
          actions: [{ type: "check_all_items" }],
        }),
      ).rejects.toMatchObject({ message: AutomationError.BOARD_NOT_FOUND });
    });

    it("a view-only member cannot create (forbidden)", async () => {
      const { board } = await seedOwnerBoard(db);
      const member = await seedUser(db, { email: "viewer@example.com" });
      await seedBoardAccess(db, board.id, member.id, ProjectPermission.View);
      const memberCaller = authedCaller(db, member.id);
      await expect(
        memberCaller.automations.create({
          boardId: board.id,
          name: "x",
          trigger: { type: "card.moved", toColumnName: null },
          actions: [{ type: "check_all_items" }],
        }),
      ).rejects.toThrow();
    });
  });

  describe("engine: card.moved", () => {
    it("matching move runs actions and logs an ok run", async () => {
      const { user, caller, board } = await seedOwnerBoard(db);
      const todo = await seedColumn(db, { boardId: board.id, name: "Todo", position: 1 });
      const done = await seedColumn(db, { boardId: board.id, name: "Done", position: 2 });
      const card = await seedCard(db, { columnId: todo.id, position: 1 });
      const other = await seedUser(db, { email: "other@example.com" });

      await caller.automations.create({
        boardId: board.id,
        name: "assign on done",
        trigger: { type: "card.moved", toColumnName: "Done" },
        actions: [{ type: "assign", userId: other.id }],
      });

      await caller.cards.move({ id: card.id, toColumnId: done.id });

      expect(await assigneesOf(db, card.id)).toContain(other.id);
      const runs = await caller.automations.runs({ boardId: board.id });
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("ok");
      void user;
    });

    it("disabled rule does not fire", async () => {
      const { caller, board } = await seedOwnerBoard(db);
      const todo = await seedColumn(db, { boardId: board.id, name: "Todo", position: 1 });
      const done = await seedColumn(db, { boardId: board.id, name: "Done", position: 2 });
      const card = await seedCard(db, { columnId: todo.id, position: 1 });
      const other = await seedUser(db, { email: "other2@example.com" });

      const rule = await caller.automations.create({
        boardId: board.id,
        name: "assign on done",
        trigger: { type: "card.moved", toColumnName: "Done" },
        actions: [{ type: "assign", userId: other.id }],
      });
      await caller.automations.update({ id: rule.id, enabled: false });

      await caller.cards.move({ id: card.id, toColumnId: done.id });

      expect(await assigneesOf(db, card.id)).toHaveLength(0);
      expect(await caller.automations.runs({ boardId: board.id })).toHaveLength(0);
    });

    it("column-name filter: a non-matching destination does not fire", async () => {
      const { caller, board } = await seedOwnerBoard(db);
      const todo = await seedColumn(db, { boardId: board.id, name: "Todo", position: 1 });
      const review = await seedColumn(db, { boardId: board.id, name: "Review", position: 2 });
      const card = await seedCard(db, { columnId: todo.id, position: 1 });
      const other = await seedUser(db, { email: "other3@example.com" });

      await caller.automations.create({
        boardId: board.id,
        name: "assign on done",
        trigger: { type: "card.moved", toColumnName: "Done" },
        actions: [{ type: "assign", userId: other.id }],
      });

      await caller.cards.move({ id: card.id, toColumnId: review.id });

      expect(await assigneesOf(db, card.id)).toHaveLength(0);
      expect(await caller.automations.runs({ boardId: board.id })).toHaveLength(0);
    });

    it("toColumnName null matches any destination", async () => {
      const { caller, board } = await seedOwnerBoard(db);
      const todo = await seedColumn(db, { boardId: board.id, name: "Todo", position: 1 });
      const review = await seedColumn(db, { boardId: board.id, name: "Review", position: 2 });
      const card = await seedCard(db, { columnId: todo.id, position: 1 });
      const other = await seedUser(db, { email: "other4@example.com" });

      await caller.automations.create({
        boardId: board.id,
        name: "assign on any move",
        trigger: { type: "card.moved", toColumnName: null },
        actions: [{ type: "assign", userId: other.id }],
      });

      await caller.cards.move({ id: card.id, toColumnId: review.id });

      expect(await assigneesOf(db, card.id)).toContain(other.id);
    });
  });

  describe("engine: card.due.approaching", () => {
    it("fires once for a card inside the window, then dedups", async () => {
      const { caller, board } = await seedOwnerBoard(db);
      const col = await seedColumn(db, { boardId: board.id, name: "Todo", position: 1 });
      const due = new Date(Date.now() + 30 * 60_000); // due in 30 min
      const card = await seedCard(db, { columnId: col.id, position: 1, dueAt: due });
      const other = await seedUser(db, { email: "due1@example.com" });

      await caller.automations.create({
        boardId: board.id,
        name: "assign when due near",
        trigger: { type: "card.due.approaching", minutesBefore: 60 },
        actions: [{ type: "assign", userId: other.id }],
      });

      expect(await runDueApproaching(db)).toBe(1);
      expect(await assigneesOf(db, card.id)).toContain(other.id);

      // Second scan must not re-fire (run-log dedup).
      expect(await runDueApproaching(db)).toBe(0);
      expect(await caller.automations.runs({ boardId: board.id })).toHaveLength(1);
    });

    it("does not fire before the window opens", async () => {
      const { caller, board } = await seedOwnerBoard(db);
      const col = await seedColumn(db, { boardId: board.id, name: "Todo", position: 1 });
      const due = new Date(Date.now() + 5 * 3_600_000); // due in 5 hours
      const card = await seedCard(db, { columnId: col.id, position: 1, dueAt: due });
      const other = await seedUser(db, { email: "due2@example.com" });

      await caller.automations.create({
        boardId: board.id,
        name: "assign when due near",
        trigger: { type: "card.due.approaching", minutesBefore: 60 },
        actions: [{ type: "assign", userId: other.id }],
      });

      expect(await runDueApproaching(db)).toBe(0);
      expect(await assigneesOf(db, card.id)).toHaveLength(0);
    });
  });
});
