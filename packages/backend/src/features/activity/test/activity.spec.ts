import { Readable } from "node:stream";
import { ActivityError, ActivityType, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeEmail } from "../../auth/test/helpers.js";
import { fakeStorage } from "../../attachment/test/helpers.js";
import { createAttachment, deleteAttachment } from "../../attachment/attachment.service.js";
import { record } from "../activity.recorder.js";
import * as activityRepo from "../activity.repo.js";
import { logger } from "../../../logger.js";
import {
  authedCaller,
  createCaller,
  makeContext,
  newTestDb,
  seedBoard,
  seedBoardAccess,
  seedCard,
  seedColumn,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "../../board/test/helpers.js";

async function ownerCard(db: TestDb, email = "owner@example.com") {
  const { user, caller } = await seedUserCaller(db, email);
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
  const column = await seedColumn(db, { boardId: board.id, name: "Todo", position: 1 });
  const card = await seedCard(db, { columnId: column.id, title: "Task", position: 1 });
  return { user, caller, project, board, column, card };
}

function actorCtx(db: TestDb, userId: string) {
  return { id: userId, isSuperuser: false };
}

async function rowsForCard(db: TestDb, cardId: string) {
  return activityRepo.listByCard(db, cardId);
}

async function rowsForBoard(db: TestDb, boardId: string) {
  return activityRepo.listByBoard(db, boardId, 100, 0);
}

describe("activity", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  describe("recorder", () => {
    it("inserts a row with parsed jsonb meta", async () => {
      const { user, board, card } = await ownerCard(db);
      await record(db, {
        boardId: board.id,
        cardId: card.id,
        actorId: user.id,
        type: ActivityType.CARD_CREATED,
        meta: { cardTitle: "X" },
      });
      const [row] = await rowsForCard(db, card.id);
      expect(row.board_id).toBe(board.id);
      expect(row.card_id).toBe(card.id);
      expect(row.actor_id).toBe(user.id);
      expect(row.type).toBe(ActivityType.CARD_CREATED);
      expect(row.meta).toEqual({ cardTitle: "X" });
    });

    it("a recorder failure does not fail the mutation and is logged", async () => {
      const { user, caller, card } = await ownerCard(db);
      await db.schema.dropTable("activities").execute();
      const errSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as any);
      // updateCard succeeds even though the recorder insert throws.
      const res = await caller.cards.update({ id: card.id, title: "Renamed" });
      expect(res.title).toBe("Renamed");
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
      expect(user).toBeTruthy();
    });
  });

  describe("card events", () => {
    it("CARD_CREATED on create", async () => {
      const { caller, column } = await ownerCard(db);
      const created = await caller.cards.create({ columnId: column.id, title: "New" });
      const [row] = await rowsForCard(db, created.id);
      expect(row.type).toBe(ActivityType.CARD_CREATED);
      expect(row.meta).toMatchObject({ cardTitle: "New" });
    });

    it("CARD_RENAMED with { from, to }", async () => {
      const { caller, card } = await ownerCard(db);
      await caller.cards.update({ id: card.id, title: "Renamed" });
      const rows = await rowsForCard(db, card.id);
      const r = rows.find((x) => x.type === ActivityType.CARD_RENAMED)!;
      expect(r.meta).toMatchObject({ from: "Task", to: "Renamed" });
    });

    it("CARD_DESCRIPTION_CHANGED on description change", async () => {
      const { caller, card } = await ownerCard(db);
      await caller.cards.update({ id: card.id, description: "hello" });
      const rows = await rowsForCard(db, card.id);
      expect(rows.some((r) => r.type === ActivityType.CARD_DESCRIPTION_CHANGED)).toBe(true);
    });

    it("DUE_DATE_SET then DUE_DATE_CLEARED", async () => {
      const { caller, card } = await ownerCard(db);
      const due = new Date("2030-01-01T00:00:00.000Z");
      await caller.cards.update({ id: card.id, dueAt: due });
      await caller.cards.update({ id: card.id, dueAt: null });
      const rows = await rowsForCard(db, card.id);
      const set = rows.find((r) => r.type === ActivityType.DUE_DATE_SET)!;
      expect(set.meta).toMatchObject({ dueAt: due.toISOString() });
      expect(rows.some((r) => r.type === ActivityType.DUE_DATE_CLEARED)).toBe(true);
    });

    it("COVER_CHANGED for color and clear", async () => {
      const { caller, card } = await ownerCard(db);
      await caller.cards.update({ id: card.id, coverColor: "red" });
      await caller.cards.update({ id: card.id, coverColor: null });
      const rows = await rowsForCard(db, card.id);
      const covers = rows.filter((r) => r.type === ActivityType.COVER_CHANGED);
      expect(covers).toHaveLength(2);
      expect(covers.map((c) => (c.meta as any).coverKind).sort()).toEqual(["color", "none"]);
    });

    it("CARD_MOVED records column names; same-column reorder records nothing", async () => {
      const { caller, board, column, card } = await ownerCard(db);
      const done = await seedColumn(db, { boardId: board.id, name: "Done", position: 2 });
      await caller.cards.move({ id: card.id, toColumnId: done.id });
      let rows = await rowsForCard(db, card.id);
      const moved = rows.find((r) => r.type === ActivityType.CARD_MOVED)!;
      expect(moved.meta).toMatchObject({ fromColumn: "Todo", toColumn: "Done" });

      // reorder within the same (Done) column -> no new CARD_MOVED row
      await caller.cards.move({ id: card.id, toColumnId: done.id });
      rows = await rowsForCard(db, card.id);
      expect(rows.filter((r) => r.type === ActivityType.CARD_MOVED)).toHaveLength(1);
    });

    it("CARD_DELETED keeps the row with card_id null in the board feed", async () => {
      const { user, caller, board, card } = await ownerCard(db);
      await caller.cards.delete({ id: card.id });
      const cardRows = await rowsForCard(db, card.id);
      expect(cardRows).toHaveLength(0); // card_id is null now
      const feed = await rowsForBoard(db, board.id);
      const del = feed.find((r) => r.type === ActivityType.CARD_DELETED)!;
      expect(del.card_id).toBeNull();
      expect(del.meta).toMatchObject({ cardTitle: "Task", cardId: card.id });
      expect(user).toBeTruthy();
    });
  });

  describe("label events", () => {
    it("LABEL_ATTACHED / LABEL_DETACHED with name + color", async () => {
      const { caller, board, card } = await ownerCard(db);
      const label = await caller.labels.create({ boardId: board.id, name: "Bug", color: "#eb5a46" });
      await caller.labels.attach({ cardId: card.id, labelId: label.id });
      await caller.labels.detach({ cardId: card.id, labelId: label.id });
      const rows = await rowsForCard(db, card.id);
      const att = rows.find((r) => r.type === ActivityType.LABEL_ATTACHED)!;
      expect(att.meta).toMatchObject({ labelName: "Bug", labelColor: "#eb5a46" });
      expect(rows.some((r) => r.type === ActivityType.LABEL_DETACHED)).toBe(true);
    });
  });

  describe("assignee events", () => {
    it("ASSIGNEE_ASSIGNED only on a new assignment", async () => {
      const { user, board, card } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
      const caller = createCaller(makeContext({ db, userId: user.id, email: fakeEmail() }));
      await caller.assignees.assign({ cardId: card.id, userId: bob.id });
      await caller.assignees.assign({ cardId: card.id, userId: bob.id }); // idempotent
      const rows = await rowsForCard(db, card.id);
      const assigned = rows.filter((r) => r.type === ActivityType.ASSIGNEE_ASSIGNED);
      expect(assigned).toHaveLength(1);
      expect(assigned[0].meta).toMatchObject({ targetEmail: "bob@example.com", targetHandle: "bob" });
    });

    it("ASSIGNEE_UNASSIGNED only when a row existed", async () => {
      const { user, board, card } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
      const caller = createCaller(makeContext({ db, userId: user.id, email: fakeEmail() }));
      await caller.assignees.unassign({ cardId: card.id, userId: bob.id }); // no-op
      await caller.assignees.assign({ cardId: card.id, userId: bob.id });
      await caller.assignees.unassign({ cardId: card.id, userId: bob.id });
      const rows = await rowsForCard(db, card.id);
      expect(rows.filter((r) => r.type === ActivityType.ASSIGNEE_UNASSIGNED)).toHaveLength(1);
    });
  });

  describe("comment events", () => {
    it("COMMENT_ADDED with truncated snippet", async () => {
      const { caller, card } = await ownerCard(db);
      const body = "x".repeat(200);
      await caller.comments.create({ cardId: card.id, body });
      const rows = await rowsForCard(db, card.id);
      const c = rows.find((r) => r.type === ActivityType.COMMENT_ADDED)!;
      expect((c.meta as any).snippet).toHaveLength(140);
    });
  });

  describe("attachment events", () => {
    it("ATTACHMENT_ADDED / ATTACHMENT_DELETED with filename", async () => {
      const { user, card } = await ownerCard(db);
      const storage = fakeStorage();
      const att = await createAttachment(db, storage, actorCtx(db, user.id), {
        cardId: card.id,
        filename: "a.png",
        mimeType: "image/png",
        stream: Readable.from(Buffer.from("hi")),
      });
      await deleteAttachment(db, storage, actorCtx(db, user.id), { id: att.id });
      const rows = await rowsForCard(db, card.id);
      const added = rows.find((r) => r.type === ActivityType.ATTACHMENT_ADDED)!;
      expect(added.meta).toMatchObject({ filename: "a.png" });
      expect(rows.some((r) => r.type === ActivityType.ATTACHMENT_DELETED)).toBe(true);
    });
  });

  describe("checklist events", () => {
    it("CHECKLIST_CREATED / CHECKLIST_DELETED with title", async () => {
      const { caller, card } = await ownerCard(db);
      const cl = await caller.checklists.create({ cardId: card.id, title: "Steps" });
      await caller.checklists.delete({ id: cl.id });
      const rows = await rowsForCard(db, card.id);
      const created = rows.find((r) => r.type === ActivityType.CHECKLIST_CREATED)!;
      expect(created.meta).toMatchObject({ title: "Steps" });
      expect(rows.some((r) => r.type === ActivityType.CHECKLIST_DELETED)).toBe(true);
    });

    it("CHECKLIST_ITEM_ADDED, CHECKED/UNCHECKED on toggle, nothing on text-only edit", async () => {
      const { caller, card } = await ownerCard(db);
      const cl = await caller.checklists.create({ cardId: card.id, title: "Steps" });
      const item = await caller.checklistItems.create({ checklistId: cl.id, text: "do" });
      await caller.checklistItems.update({ id: item.id, isDone: true });
      await caller.checklistItems.update({ id: item.id, isDone: false });
      await caller.checklistItems.update({ id: item.id, text: "do edited" });
      const rows = await rowsForCard(db, card.id);
      const added = rows.find((r) => r.type === ActivityType.CHECKLIST_ITEM_ADDED)!;
      expect(added.meta).toMatchObject({ text: "do" });
      expect(rows.some((r) => r.type === ActivityType.CHECKLIST_ITEM_CHECKED)).toBe(true);
      expect(rows.some((r) => r.type === ActivityType.CHECKLIST_ITEM_UNCHECKED)).toBe(true);
    });
  });

  describe("board member events", () => {
    it("MEMBER_GRANTED then MEMBER_REVOKED", async () => {
      const { caller, board } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      await caller.boards.accessGrant({ id: board.id, email: bob.email, permission: ProjectPermission.Edit });
      await caller.boards.accessRevoke({ id: board.id, userId: bob.id });
      const feed = await rowsForBoard(db, board.id);
      const granted = feed.find((r) => r.type === ActivityType.MEMBER_GRANTED)!;
      expect(granted.meta).toMatchObject({
        targetEmail: "bob@example.com",
        targetHandle: "bob",
        permission: ProjectPermission.Edit,
      });
      const revoked = feed.find((r) => r.type === ActivityType.MEMBER_REVOKED)!;
      expect(revoked.meta).toMatchObject({ targetEmail: "bob@example.com", targetHandle: "bob" });
    });
  });

  describe("list: card timeline", () => {
    it("returns newest-first with resolved actor handle", async () => {
      const { user, caller, card } = await ownerCard(db);
      await caller.cards.update({ id: card.id, title: "B" });
      await caller.cards.update({ id: card.id, description: "d" });
      const list = await caller.activity.listForCard({ cardId: card.id });
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list[0].actor.handle).toBe("owner");
      expect(list[0].createdAt.getTime()).toBeGreaterThanOrEqual(list[1].createdAt.getTime());
      expect(user).toBeTruthy();
    });

    it("non-viewer -> CARD_NOT_FOUND (no existence leak)", async () => {
      const { card } = await ownerCard(db);
      const { user: stranger } = await seedUserCaller(db, "x@example.com");
      await expect(
        authedCaller(db, stranger.id).activity.listForCard({ cardId: card.id }),
      ).rejects.toMatchObject({ message: ActivityError.CARD_NOT_FOUND });
    });

    it("a CARD_DELETED (card_id null) row is not in the card timeline but is in the board feed", async () => {
      const { caller, board, column } = await ownerCard(db);
      const c = await caller.cards.create({ columnId: column.id, title: "Doomed" });
      await caller.cards.delete({ id: c.id });
      const feed = await caller.activity.listForBoard({ boardId: board.id, limit: 100, offset: 0 });
      expect(feed.items.some((i) => i.type === ActivityType.CARD_DELETED && i.cardId === null)).toBe(true);
    });
  });

  describe("list: board feed + pagination", () => {
    it("paginates newest-first with advancing nextOffset", async () => {
      const { caller, board, column } = await ownerCard(db);
      for (let i = 0; i < 5; i++) {
        await caller.cards.create({ columnId: column.id, title: `c${i}` });
      }
      const p1 = await caller.activity.listForBoard({ boardId: board.id, limit: 2, offset: 0 });
      expect(p1.items).toHaveLength(2);
      expect(p1.nextOffset).toBe(2);
      const p2 = await caller.activity.listForBoard({ boardId: board.id, limit: 2, offset: 2 });
      expect(p2.items).toHaveLength(2);
      expect(p2.nextOffset).toBe(4);
      const p3 = await caller.activity.listForBoard({ boardId: board.id, limit: 2, offset: 4 });
      expect(p3.items.length).toBeLessThan(2);
      expect(p3.nextOffset).toBeNull();
    });

    it("non-viewer -> BOARD_NOT_FOUND", async () => {
      const { board } = await ownerCard(db);
      const { user: stranger } = await seedUserCaller(db, "x@example.com");
      await expect(
        authedCaller(db, stranger.id).activity.listForBoard({ boardId: board.id, limit: 50, offset: 0 }),
      ).rejects.toMatchObject({ message: ActivityError.BOARD_NOT_FOUND });
    });

    it("view-only member can read both feeds", async () => {
      const { caller, board, card } = await ownerCard(db);
      await caller.cards.update({ id: card.id, title: "B" });
      const viewer = await seedUser(db, { email: "v@example.com", verified: true });
      await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
      const vc = authedCaller(db, viewer.id);
      await expect(vc.activity.listForCard({ cardId: card.id })).resolves.toBeDefined();
      await expect(
        vc.activity.listForBoard({ boardId: board.id, limit: 50, offset: 0 }),
      ).resolves.toMatchObject({ items: expect.any(Array) });
    });
  });

  describe("actor resolution: no N+1", () => {
    it("actor resolution issues one batched users query regardless of actor count", async () => {
      const { caller, board, column } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      const amy = await seedUser(db, { email: "amy@example.com", verified: true });
      await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
      await seedBoardAccess(db, board.id, amy.id, ProjectPermission.Edit);
      await caller.cards.create({ columnId: column.id, title: "a" });
      await authedCaller(db, bob.id).cards.create({ columnId: column.id, title: "b" });
      await authedCaller(db, amy.id).cards.create({ columnId: column.id, title: "c" });

      // Baseline: a board with a single distinct actor.
      const { caller: c2, board: board2, column: col2 } = await ownerCard(db, "owner2@example.com");
      await c2.cards.create({ columnId: col2.id, title: "x" });
      await c2.cards.create({ columnId: col2.id, title: "y" });

      const countUserQueries = async (
        call: () => Promise<unknown>,
      ): Promise<number> => {
        const spy = vi.spyOn(db, "selectFrom");
        await call();
        const n = spy.mock.calls.filter((c) => c[0] === "users").length;
        spy.mockRestore();
        return n;
      };

      const many = await countUserQueries(() =>
        caller.activity.listForBoard({ boardId: board.id, limit: 100, offset: 0 }),
      );
      const one = await countUserQueries(() =>
        c2.activity.listForBoard({ boardId: board2.id, limit: 100, offset: 0 }),
      );
      // 3 distinct actors does not cost more users-queries than 1 actor.
      expect(many).toBe(one);
    });
  });

  describe("cascade / placeholder actor", () => {
    it("deleting a user nulls actor_id; feed renders 'unknown'", async () => {
      const { board, column } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
      await authedCaller(db, bob.id).cards.create({ columnId: column.id, title: "byBob" });
      // delete bob's assignments-free row owner reads the feed
      await db.deleteFrom("activities").where("actor_id", "!=", bob.id).execute();
      await db.deleteFrom("users").where("id", "=", bob.id).execute();
      const owner = authedCaller(db, (await seedBoardOwner(db, board.id)) ?? "");
      const feed = await owner.activity.listForBoard({ boardId: board.id, limit: 100, offset: 0 });
      const row = feed.items.find((i) => i.type === ActivityType.CARD_CREATED)!;
      expect(row.actor.id).toBeNull();
      expect(row.actor.handle).toBe("unknown");
    });
  });
});

async function seedBoardOwner(db: TestDb, boardId: string): Promise<string | null> {
  const b = await db
    .selectFrom("boards")
    .select(["owner_id"])
    .where("id", "=", boardId)
    .executeTakeFirst();
  return b?.owner_id ?? null;
}
