import { ProjectVisibility } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as boardSvc from "../../board/board.service.js";
import * as repo from "../search.repo.js";
import {
  authedCaller,
  newTestDb,
  seedAccess,
  seedBoard,
  seedBoardAccess,
  seedCard,
  seedColumn,
  seedProject,
  seedUser,
  seedUserCaller,
  superuserCaller,
  type TestDb,
} from "../../board/test/helpers.js";

// pg-mem skews stored timestamptz by the local TZ offset (~1h) on read but not
// query params, so day-scale deltas are used to keep due-window tests robust.
const DAY = 24 * 60 * 60 * 1000;

// pg-mem stores due_at correctly on INSERT but mangles it on UPDATE (breaks
// `<` comparisons), so seed due dates at insert time.
async function seedDueCard(
  db: TestDb,
  opts: { columnId: string; title?: string; position: number; dueAt: Date | null },
) {
  return db
    .insertInto("cards")
    .values({
      column_id: opts.columnId,
      title: opts.title ?? "Task",
      position: opts.position,
      due_at: opts.dueAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function ownerTree(db: TestDb, email = "owner@example.com") {
  const { user, caller } = await seedUserCaller(db, email);
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
  const column = await seedColumn(db, { boardId: board.id, name: "Todo", position: 1 });
  return { user, caller, project, board, column };
}

describe("search.cards", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.destroy();
  });

  describe("empty / short query", () => {
    it("q='' and no filter returns empty page without a DB call", async () => {
      const { caller } = await ownerTree(db);
      const spy = vi.spyOn(repo, "searchCards");
      const res = await caller.search.cards({ q: "", limit: 20, offset: 0 });
      expect(res).toEqual({ items: [], nextOffset: null });
      expect(spy).not.toHaveBeenCalled();
    });

    it("whitespace-only query with no filter returns empty page, no DB call", async () => {
      const { caller } = await ownerTree(db);
      const spy = vi.spyOn(repo, "searchCards");
      const res = await caller.search.cards({ q: "   ", limit: 20, offset: 0 });
      expect(res.items).toHaveLength(0);
      expect(spy).not.toHaveBeenCalled();
    });

    it("q='' WITH a filter runs the no-text path", async () => {
      const { caller, column } = await ownerTree(db);
      await seedDueCard(db, {
        columnId: column.id,
        title: "Overdue task",
        position: 1,
        dueAt: new Date(Date.now() - 2 * DAY),
      });
      const res = await caller.search.cards({
        q: "",
        due: "overdue",
        limit: 20,
        offset: 0,
      });
      expect(res.items).toHaveLength(1);
      expect(res.items[0].title).toBe("Overdue task");
      expect(res.items[0].isOverdue).toBe(true);
    });
  });

  describe("filters", () => {
    it("filters by labelIds (at least one)", async () => {
      const { caller, board, column } = await ownerTree(db);
      const c1 = await seedCard(db, { columnId: column.id, title: "A", position: 1 });
      const c2 = await seedCard(db, { columnId: column.id, title: "B", position: 2 });
      const label = await db
        .insertInto("labels")
        .values({ board_id: board.id, name: "L", color: "#61bd4f" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .insertInto("card_labels")
        .values({ card_id: c1.id, label_id: label.id })
        .execute();
      const res = await caller.search.cards({
        q: "",
        labelIds: [label.id],
        limit: 20,
        offset: 0,
      });
      expect(res.items.map((i) => i.cardId)).toEqual([c1.id]);
      expect(res.items.map((i) => i.cardId)).not.toContain(c2.id);
    });

    it("filters by assigneeIds via card_assignees.user_id", async () => {
      const { caller, column, user } = await ownerTree(db);
      const c1 = await seedCard(db, { columnId: column.id, title: "A", position: 1 });
      await seedCard(db, { columnId: column.id, title: "B", position: 2 });
      await db
        .insertInto("card_assignees")
        .values({ card_id: c1.id, user_id: user.id })
        .execute();
      const res = await caller.search.cards({
        q: "",
        assigneeIds: [user.id],
        limit: 20,
        offset: 0,
      });
      expect(res.items.map((i) => i.cardId)).toEqual([c1.id]);
    });

    it("due overdue / due_soon / has_due", async () => {
      const { caller, column } = await ownerTree(db);
      const now = Date.now();
      const overdue = await seedDueCard(db, { columnId: column.id, title: "O", position: 1, dueAt: new Date(now - 2 * DAY) });
      const soon = await seedDueCard(db, { columnId: column.id, title: "S", position: 2, dueAt: new Date(now + 0.5 * DAY) });
      const far = await seedDueCard(db, { columnId: column.id, title: "F", position: 3, dueAt: new Date(now + 3 * DAY) });
      await seedDueCard(db, { columnId: column.id, title: "None", position: 4, dueAt: null });

      const od = await caller.search.cards({ q: "", due: "overdue", limit: 20, offset: 0 });
      expect(od.items.map((i) => i.cardId)).toEqual([overdue.id]);

      const ds = await caller.search.cards({ q: "", due: "due_soon", limit: 20, offset: 0 });
      expect(ds.items.map((i) => i.cardId)).toEqual([soon.id]);

      const hd = await caller.search.cards({ q: "", due: "has_due", limit: 20, offset: 0 });
      expect(hd.items.map((i) => i.cardId).sort()).toEqual([overdue.id, soon.id, far.id].sort());
    });

    it("projectId / boardId scope narrows; unviewable scope returns empty", async () => {
      const { user, caller, project, board, column } = await ownerTree(db);
      const card = await seedCard(db, { columnId: column.id, title: "X", position: 1 });
      // second project/board the user also owns
      const p2 = await seedProject(db, { ownerId: user.id, name: "P2" });
      const b2 = await seedBoard(db, { projectId: p2.id, ownerId: user.id });
      const col2 = await seedColumn(db, { boardId: b2.id, position: 1 });
      await seedCard(db, { columnId: col2.id, title: "Y", position: 1 });

      const byProject = await caller.search.cards({ q: "", projectId: project.id, limit: 20, offset: 0 });
      expect(byProject.items.map((i) => i.cardId)).toEqual([card.id]);

      const byBoard = await caller.search.cards({ q: "", boardId: board.id, limit: 20, offset: 0 });
      expect(byBoard.items.map((i) => i.cardId)).toEqual([card.id]);

      // a board the user cannot view -> empty
      const { user: other } = await seedUserCaller(db, "other@example.com");
      const otherP = await seedProject(db, { ownerId: other.id, name: "Priv" });
      const otherB = await seedBoard(db, { projectId: otherP.id, ownerId: other.id });
      const scoped = await caller.search.cards({ q: "", boardId: otherB.id, limit: 20, offset: 0 });
      expect(scoped.items).toHaveLength(0);
    });

    it("multiple filters compose with AND", async () => {
      const { caller, board, column, user } = await ownerTree(db);
      const match = await seedDueCard(db, { columnId: column.id, title: "M", position: 1, dueAt: new Date(Date.now() - 2 * DAY) });
      const partial = await seedCard(db, { columnId: column.id, title: "P", position: 2 });
      const label = await db
        .insertInto("labels")
        .values({ board_id: board.id, name: "L", color: "#61bd4f" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db.insertInto("card_labels").values({ card_id: match.id, label_id: label.id }).execute();
      await db.insertInto("card_labels").values({ card_id: partial.id, label_id: label.id }).execute();
      await db.insertInto("card_assignees").values({ card_id: match.id, user_id: user.id }).execute();

      const res = await caller.search.cards({
        q: "",
        labelIds: [label.id],
        assigneeIds: [user.id],
        due: "overdue",
        limit: 20,
        offset: 0,
      });
      expect(res.items.map((i) => i.cardId)).toEqual([match.id]);
    });
  });

  describe("permission scoping", () => {
    it("OWN board: owner sees their cards", async () => {
      const { caller, column } = await ownerTree(db);
      const card = await seedCard(db, { columnId: column.id, title: "X", position: 1 });
      const res = await caller.search.cards({ q: "", due: "has_due", limit: 20, offset: 0 });
      expect(res.items).toHaveLength(0); // no due set; use a filter that matches
      await db.updateTable("cards").set({ due_at: new Date() }).where("id", "=", card.id).execute();
      const res2 = await caller.search.cards({ q: "", due: "has_due", limit: 20, offset: 0 });
      expect(res2.items.map((i) => i.cardId)).toEqual([card.id]);
    });

    it("BOARD GRANT: a board_access view grant exposes that board's cards", async () => {
      const { board, column } = await ownerTree(db);
      const card = await seedCard(db, { columnId: column.id, position: 1 });
      await db.updateTable("cards").set({ due_at: new Date() }).execute();
      const { user: viewer } = await seedUserCaller(db, "viewer@example.com");
      await seedBoardAccess(db, board.id, viewer.id, "view" as never);
      const caller = authedCaller(db, viewer.id);
      const res = await caller.search.cards({ q: "", due: "has_due", limit: 20, offset: 0 });
      expect(res.items.map((i) => i.cardId)).toEqual([card.id]);
    });

    it("PROJECT GRANT (inheritance): project_access but no board_access", async () => {
      const { project, column } = await ownerTree(db);
      await seedCard(db, { columnId: column.id, position: 1 });
      await db.updateTable("cards").set({ due_at: new Date() }).execute();
      const { user: viewer } = await seedUserCaller(db, "viewer@example.com");
      await seedAccess(db, project.id, viewer.id, "view" as never);
      const caller = authedCaller(db, viewer.id);
      const res = await caller.search.cards({ q: "", due: "has_due", limit: 20, offset: 0 });
      expect(res.items).toHaveLength(1);
    });

    it("PROJECT OWNER sees a board they did not create", async () => {
      const { user: owner } = await seedUserCaller(db, "owner@example.com");
      const project = await seedProject(db, { ownerId: owner.id });
      const { user: other } = await seedUserCaller(db, "other@example.com");
      const board = await seedBoard(db, { projectId: project.id, ownerId: other.id });
      const column = await seedColumn(db, { boardId: board.id, position: 1 });
      await seedCard(db, { columnId: column.id, position: 1 });
      await db.updateTable("cards").set({ due_at: new Date() }).execute();
      const caller = authedCaller(db, owner.id);
      const res = await caller.search.cards({ q: "", due: "has_due", limit: 20, offset: 0 });
      expect(res.items).toHaveLength(1);
    });

    it("PUBLIC PROJECT: any authed user sees its cards with no grant", async () => {
      const { user: owner } = await seedUserCaller(db, "owner@example.com");
      const project = await seedProject(db, { ownerId: owner.id, visibility: ProjectVisibility.Public });
      const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
      const column = await seedColumn(db, { boardId: board.id, position: 1 });
      await seedCard(db, { columnId: column.id, position: 1 });
      await db.updateTable("cards").set({ due_at: new Date() }).execute();
      const { user: stranger } = await seedUserCaller(db, "stranger@example.com");
      const caller = authedCaller(db, stranger.id);
      const res = await caller.search.cards({ q: "", due: "has_due", limit: 20, offset: 0 });
      expect(res.items).toHaveLength(1);
    });

    it("NO LEAK: user A cannot see user B's private board cards", async () => {
      const { column } = await ownerTree(db);
      await seedCard(db, { columnId: column.id, position: 1 });
      await db.updateTable("cards").set({ due_at: new Date() }).execute();
      const { caller } = await seedUserCaller(db, "outsider@example.com");
      const res = await caller.search.cards({ q: "", due: "has_due", limit: 20, offset: 0 });
      expect(res.items).toHaveLength(0);
      expect(res.nextOffset).toBeNull();
    });

    it("SUPERUSER sees all cards including private boards", async () => {
      const { column } = await ownerTree(db);
      await seedCard(db, { columnId: column.id, position: 1 });
      await db.updateTable("cards").set({ due_at: new Date() }).execute();
      const { caller } = await superuserCaller(db);
      const res = await caller.search.cards({ q: "", due: "has_due", limit: 20, offset: 0 });
      expect(res.items).toHaveLength(1);
    });

    it("de-dup: board grant AND project grant yields one row", async () => {
      const { project, board, column } = await ownerTree(db);
      const card = await seedCard(db, { columnId: column.id, position: 1 });
      await db.updateTable("cards").set({ due_at: new Date() }).execute();
      const { user: viewer } = await seedUserCaller(db, "viewer@example.com");
      await seedBoardAccess(db, board.id, viewer.id, "view" as never);
      await seedAccess(db, project.id, viewer.id, "view" as never);
      const caller = authedCaller(db, viewer.id);
      const res = await caller.search.cards({ q: "", due: "has_due", limit: 20, offset: 0 });
      expect(res.items.map((i) => i.cardId)).toEqual([card.id]);
    });
  });

  describe("pagination", () => {
    it("paginates with nextOffset and no overlap", async () => {
      const { caller, column } = await ownerTree(db);
      for (let i = 0; i < 5; i++) {
        await seedCard(db, { columnId: column.id, title: `C${i}`, position: i + 1 });
      }
      await db.updateTable("cards").set({ due_at: new Date() }).execute();

      const p1 = await caller.search.cards({ q: "", due: "has_due", limit: 2, offset: 0 });
      expect(p1.items).toHaveLength(2);
      expect(p1.nextOffset).toBe(2);

      const p2 = await caller.search.cards({ q: "", due: "has_due", limit: 2, offset: 2 });
      expect(p2.items).toHaveLength(2);
      expect(p2.nextOffset).toBe(4);

      const p3 = await caller.search.cards({ q: "", due: "has_due", limit: 2, offset: 4 });
      expect(p3.items).toHaveLength(1);
      expect(p3.nextOffset).toBeNull();

      const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.cardId);
      expect(new Set(ids).size).toBe(5);
    });
  });

  describe("no N+1", () => {
    it("calls repo once and never resolveBoardPermission/loadBoardFor", async () => {
      const { user, caller } = await ownerTree(db);
      const p2 = await seedProject(db, { ownerId: user.id, name: "P2" });
      const b2 = await seedBoard(db, { projectId: p2.id, ownerId: user.id });
      for (const board of [b2]) {
        const col = await seedColumn(db, { boardId: board.id, position: 1 });
        for (let i = 0; i < 3; i++) {
          await seedCard(db, { columnId: col.id, title: `C${i}`, position: i + 1 });
        }
      }
      await db.updateTable("cards").set({ due_at: new Date() }).execute();

      const repoSpy = vi.spyOn(repo, "searchCards");
      const resolveSpy = vi.spyOn(boardSvc, "resolveBoardPermission");
      const loadSpy = vi.spyOn(boardSvc, "loadBoardFor");

      const res = await caller.search.cards({ q: "", due: "has_due", limit: 20, offset: 0 });
      expect(res.items.length).toBeGreaterThan(0);
      expect(repoSpy).toHaveBeenCalledTimes(1);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(loadSpy).not.toHaveBeenCalled();
    });
  });

  // Full-text behavior (title/description match, ranking title>description,
  // plain-text snippet) is validated on live Postgres only (CLAUDE.md): pg-mem
  // has no tsvector/@@/ts_rank/ts_headline. Here we only assert the compiled SQL
  // of the hasText=true query carries the Postgres full-text operators.
  describe("text path (compiled SQL; full-text runs on live PG)", () => {
    const opts = {
      userId: "u1",
      isSuperuser: false,
      q: "deploy pipeline",
      hasText: true,
      now: new Date(),
      limit: 20,
      offset: 0,
    };

    it("emits websearch_to_tsquery, @@, ts_rank and a parameterized q", () => {
      const compiled = repo.buildSearchQuery(db, opts).compile();
      expect(compiled.sql).toContain("websearch_to_tsquery");
      expect(compiled.sql).toContain("@@");
      expect(compiled.sql).toContain("ts_rank");
      expect(compiled.sql).toContain("ts_headline");
      // q is bound as a parameter, never concatenated (no injection).
      expect(compiled.parameters).toContain("deploy pipeline");
      expect(compiled.sql).not.toContain("deploy pipeline");
    });

    it("snippet ts_headline options bind sentinel StartSel/StopSel (stripped in service)", () => {
      const compiled = repo.buildSearchQuery(db, opts).compile();
      // Options are a bound parameter (not concatenated into the SQL).
      const opt = compiled.parameters.find(
        (p) => typeof p === "string" && p.includes("StartSel="),
      ) as string | undefined;
      expect(opt).toBeDefined();
      expect(opt).toContain(repo.SNIPPET_SEL_START);
      expect(opt).toContain(repo.SNIPPET_SEL_STOP);
      // Empty StartSel=,StopSel= (the mis-parsed form) must NOT be used.
      expect(opt).not.toContain("StartSel=,StopSel=");
    });

    it("no-text query omits all full-text operators (pg-mem safe)", () => {
      const compiled = repo
        .buildSearchQuery(db, { ...opts, q: "", hasText: false })
        .compile();
      expect(compiled.sql).not.toContain("websearch_to_tsquery");
      expect(compiled.sql).not.toContain("@@");
      expect(compiled.sql).not.toContain("ts_rank");
      expect(compiled.sql).not.toContain("search_vector");
    });
  });
});
