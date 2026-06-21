import { BoardViewError, defaultBoardView, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../../logger.js";
import {
  authedCaller,
  newTestDb,
  seedBoard,
  seedBoardAccess,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "../../board/test/helpers.js";

async function ownerBoard(db: TestDb, email = "owner@example.com") {
  const { user, caller } = await seedUserCaller(db, email);
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
  return { user, caller, project, board };
}

async function rowFor(db: TestDb, userId: string, boardId: string) {
  return db
    .selectFrom("board_views")
    .selectAll()
    .where("user_id", "=", userId)
    .where("board_id", "=", boardId)
    .executeTakeFirst();
}

async function rowsForBoard(db: TestDb, boardId: string) {
  return db.selectFrom("board_views").selectAll().where("board_id", "=", boardId).execute();
}

describe("boardViews", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  describe("get - default when none", () => {
    it("returns defaultBoardView for a viewable board with no saved row", async () => {
      const { caller, board } = await ownerBoard(db);
      const view = await caller.boardViews.get({ boardId: board.id });
      expect(view).toEqual(defaultBoardView);
    });
  });

  describe("upsert creates then updates", () => {
    it("set creates a row; get returns it; single row", async () => {
      const { user, caller, board } = await ownerBoard(db);
      const config = { labelIds: ["L1"], assigneeIds: [], assignedToMe: false, due: "overdue" as const, swimlaneBy: null };
      const saved = await caller.boardViews.set({ boardId: board.id, mode: "table", config });
      expect(saved).toEqual({ mode: "table", config });
      const got = await caller.boardViews.get({ boardId: board.id });
      expect(got).toEqual({ mode: "table", config });
      expect(await rowsForBoard(db, board.id)).toHaveLength(1);
      expect((await rowFor(db, user.id, board.id))!.user_id).toBe(user.id);
    });

    it("a second set updates the same row (one row, advanced updated_at)", async () => {
      const { user, caller, board } = await ownerBoard(db);
      await caller.boardViews.set({
        boardId: board.id,
        mode: "table",
        config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null },
      });
      const first = await rowFor(db, user.id, board.id);
      await caller.boardViews.set({
        boardId: board.id,
        mode: "swimlanes",
        config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: "assignee" },
      });
      const rows = await rowsForBoard(db, board.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].mode).toBe("swimlanes");
      expect(rows[0].config).toMatchObject({ swimlaneBy: "assignee" });
      expect(new Date(rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(first!.updated_at).getTime(),
      );
      const got = await caller.boardViews.get({ boardId: board.id });
      expect(got.mode).toBe("swimlanes");
      expect(got.config.swimlaneBy).toBe("assignee");
    });
  });

  describe("per-user isolation", () => {
    it("each user gets only their own view for the same board", async () => {
      const { user: owner, caller: ownerCaller, board } = await ownerBoard(db);
      const member = await seedUser(db, { email: "member@example.com" });
      await seedBoardAccess(db, board.id, member.id, ProjectPermission.View);
      const memberCaller = authedCaller(db, member.id);

      await ownerCaller.boardViews.set({
        boardId: board.id,
        mode: "table",
        config: { labelIds: ["A"], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null },
      });
      await memberCaller.boardViews.set({
        boardId: board.id,
        mode: "calendar",
        config: { labelIds: ["B"], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null },
      });

      expect((await ownerCaller.boardViews.get({ boardId: board.id })).mode).toBe("table");
      expect((await memberCaller.boardViews.get({ boardId: board.id })).mode).toBe("calendar");
      expect(await rowsForBoard(db, board.id)).toHaveLength(2);
      void owner;
    });
  });

  describe("config round-trips through jsonb", () => {
    it("stored row config is a parsed object equal to sent config", async () => {
      const { user, caller, board } = await ownerBoard(db);
      const config = { labelIds: ["L1", "L2"], assigneeIds: ["U1"], assignedToMe: true, due: "due_soon" as const, swimlaneBy: "label" as const };
      await caller.boardViews.set({ boardId: board.id, mode: "swimlanes", config });
      const row = await rowFor(db, user.id, board.id);
      expect(row!.config).toEqual(config);
      expect(Array.isArray(row!.config.labelIds)).toBe(true);
      expect(row!.config.due).toBe("due_soon");
      expect(row!.config.swimlaneBy).toBe("label");
    });
  });

  describe("permission", () => {
    it("get for an inaccessible board -> BOARD_NOT_FOUND", async () => {
      const { board } = await ownerBoard(db);
      const stranger = await seedUser(db, { email: "stranger@example.com" });
      const strangerCaller = authedCaller(db, stranger.id);
      await expect(
        strangerCaller.boardViews.get({ boardId: board.id }),
      ).rejects.toMatchObject({ message: BoardViewError.BOARD_NOT_FOUND });
    });

    it("set for an inaccessible board -> BOARD_NOT_FOUND, no row written", async () => {
      const { board } = await ownerBoard(db);
      const stranger = await seedUser(db, { email: "stranger2@example.com" });
      const strangerCaller = authedCaller(db, stranger.id);
      await expect(
        strangerCaller.boardViews.set({
          boardId: board.id,
          mode: "table",
          config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null },
        }),
      ).rejects.toMatchObject({ message: BoardViewError.BOARD_NOT_FOUND });
      expect(await rowFor(db, stranger.id, board.id)).toBeUndefined();
    });

    it("a view-only member can set and get their own view", async () => {
      const { board } = await ownerBoard(db);
      const member = await seedUser(db, { email: "viewer@example.com" });
      await seedBoardAccess(db, board.id, member.id, ProjectPermission.View);
      const memberCaller = authedCaller(db, member.id);
      const saved = await memberCaller.boardViews.set({
        boardId: board.id,
        mode: "calendar",
        config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null },
      });
      expect(saved.mode).toBe("calendar");
      expect((await memberCaller.boardViews.get({ boardId: board.id })).mode).toBe("calendar");
    });
  });

  describe("invalid input rejected by Zod", () => {
    it("unknown mode -> error, no row", async () => {
      const { user, caller, board } = await ownerBoard(db);
      await expect(
        caller.boardViews.set({
          boardId: board.id,
          // @ts-expect-error invalid mode
          mode: "gantt",
          config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null },
        }),
      ).rejects.toThrow();
      expect(await rowFor(db, user.id, board.id)).toBeUndefined();
    });

    it("invalid due -> error", async () => {
      const { caller, board } = await ownerBoard(db);
      await expect(
        caller.boardViews.set({
          boardId: board.id,
          mode: "table",
          // @ts-expect-error invalid due
          config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: "someday", swimlaneBy: null },
        }),
      ).rejects.toThrow();
    });

    it("unknown config key -> error (strict)", async () => {
      const { caller, board } = await ownerBoard(db);
      await expect(
        caller.boardViews.set({
          boardId: board.id,
          mode: "table",
          // @ts-expect-error unknown key
          config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null, evil: 1 },
        }),
      ).rejects.toThrow();
    });

    it("invalid swimlaneBy -> error", async () => {
      const { caller, board } = await ownerBoard(db);
      await expect(
        caller.boardViews.set({
          boardId: board.id,
          mode: "swimlanes",
          // @ts-expect-error invalid swimlaneBy
          config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: "color" },
        }),
      ).rejects.toThrow();
    });

    it("a partial config is normalized to a complete config", async () => {
      const { caller, board } = await ownerBoard(db);
      await caller.boardViews.set({
        boardId: board.id,
        mode: "table",
        config: { labelIds: ["L1"] },
      });
      const got = await caller.boardViews.get({ boardId: board.id });
      expect(got.config).toEqual({
        labelIds: ["L1"],
        assigneeIds: [],
        assignedToMe: false,
        due: null,
        swimlaneBy: null,
      });
    });
  });

  describe("defensive read of a stale stored row", () => {
    it("a row failing the strict schema -> get returns default + logs", async () => {
      const { user, caller, board } = await ownerBoard(db);
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
      await db
        .insertInto("board_views")
        .values({
          user_id: user.id,
          board_id: board.id,
          mode: "gantt", // not in the enum
          config: JSON.stringify({ labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null }),
          updated_at: new Date(),
        })
        .execute();
      const got = await caller.boardViews.get({ boardId: board.id });
      expect(got).toEqual(defaultBoardView);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("cascade", () => {
    it("deleting the board removes the saved view", async () => {
      const { user, caller, board } = await ownerBoard(db);
      await caller.boardViews.set({
        boardId: board.id,
        mode: "table",
        config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null },
      });
      await db.deleteFrom("boards").where("id", "=", board.id).execute();
      expect(await rowFor(db, user.id, board.id)).toBeUndefined();
    });

    it("deleting the user removes their saved views", async () => {
      const { user, caller, board } = await ownerBoard(db);
      await caller.boardViews.set({
        boardId: board.id,
        mode: "table",
        config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null },
      });
      await db.deleteFrom("board_access").where("user_id", "=", user.id).execute();
      await db.deleteFrom("boards").where("owner_id", "=", user.id).execute();
      await db.deleteFrom("projects").where("owner_id", "=", user.id).execute();
      await db.deleteFrom("users").where("id", "=", user.id).execute();
      expect(await rowFor(db, user.id, board.id)).toBeUndefined();
    });
  });
});
