import { NotificationType, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeEmail } from "../../auth/test/helpers.js";
import { bus } from "../../realtime/realtime.bus.js";
import { logger } from "../../../logger.js";
import { runDueReminders } from "../../card/card.reminder.js";
import { create } from "../notification.recorder.js";
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
} from "../../comment/test/helpers.js";

async function ownerCard(db: TestDb) {
  const { user, caller } = await seedUserCaller(db, "owner@example.com");
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
  const column = await seedColumn(db, { boardId: board.id, position: 1 });
  const card = await seedCard(db, { columnId: column.id, position: 1 });
  return { user, caller, project, board, column, card };
}

function rowsFor(db: TestDb, userId: string) {
  return db
    .selectFrom("notifications")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc")
    .execute();
}

describe("notifications - creation at the 3 points", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
    vi.restoreAllMocks();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("MENTION created for the mentioned member; mention email still sent", async () => {
    const { user, board, card } = await ownerCard(db);
    const bob = await seedUser(db, { email: "bob@example.com", verified: true });
    await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
    const email = fakeEmail();
    const caller = createCaller(makeContext({ db, userId: user.id, email }));
    await caller.comments.create({ cardId: card.id, body: "ping @bob look" });

    const rows = await rowsFor(db, bob.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(NotificationType.MENTION);
    expect(rows[0].read_at).toBeNull();
    expect(rows[0].payload).toMatchObject({
      boardId: board.id,
      cardId: card.id,
      actorHandle: "owner",
      title: card.title,
      snippet: "ping @bob look",
    });
    expect(email.sent.filter((e) => e.type === "mention")).toHaveLength(1);
  });

  it("self-mention creates NO notification row", async () => {
    const { user, card } = await ownerCard(db);
    const caller = authedCaller(db, user.id);
    await caller.comments.create({ cardId: card.id, body: "note to @owner self" });
    expect(await rowsFor(db, user.id)).toHaveLength(0);
  });

  it("CARD_ASSIGNED created for the assignee; assigned email still sent", async () => {
    const { user, board, card } = await ownerCard(db);
    const bob = await seedUser(db, { email: "bob@example.com", verified: true });
    await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
    const email = fakeEmail();
    const caller = createCaller(makeContext({ db, userId: user.id, email }));
    await caller.assignees.assign({ cardId: card.id, userId: bob.id });

    const rows = await rowsFor(db, bob.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(NotificationType.CARD_ASSIGNED);
    expect(rows[0].payload).toMatchObject({
      boardId: board.id,
      cardId: card.id,
      actorHandle: "owner",
      title: card.title,
    });
    expect(email.sent.filter((e) => e.type === "assigned")).toHaveLength(1);
  });

  it("self-assign creates NO notification row AND no assigned email", async () => {
    const { user, card } = await ownerCard(db);
    const email = fakeEmail();
    const caller = createCaller(makeContext({ db, userId: user.id, email }));
    await caller.assignees.assign({ cardId: card.id, userId: user.id });
    expect(await rowsFor(db, user.id)).toHaveLength(0);
    expect(email.sent.filter((e) => e.type === "assigned")).toHaveLength(0);
  });

  it("CARD_DUE_SOON created per board member (actorHandle null); idempotent", async () => {
    const { user, board, column } = await ownerCard(db);
    const bob = await seedUser(db, { email: "bob@example.com", verified: true });
    await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
    const dueAt = new Date(Date.now() + 5 * 60_000);
    const card = await seedCard(db, {
      columnId: column.id,
      position: 2,
      dueAt,
      reminderMinutes: 60,
    });
    const email = fakeEmail();

    const sent = await runDueReminders(db, email);
    expect(sent).toBe(1);

    const ownerRows = (await rowsFor(db, user.id)).filter(
      (r) => r.type === NotificationType.CARD_DUE_SOON,
    );
    const bobRows = (await rowsFor(db, bob.id)).filter(
      (r) => r.type === NotificationType.CARD_DUE_SOON,
    );
    expect(ownerRows).toHaveLength(1);
    expect(bobRows).toHaveLength(1);
    expect(bobRows[0].payload).toMatchObject({
      boardId: board.id,
      cardId: card.id,
      actorHandle: null,
      title: card.title,
    });
    expect(email.sent.filter((e) => e.type === "due")).toHaveLength(2);

    // re-run: reminder_sent_at idempotency -> no second row
    await runDueReminders(db, email);
    const bobAgain = (await rowsFor(db, bob.id)).filter(
      (r) => r.type === NotificationType.CARD_DUE_SOON,
    );
    expect(bobAgain).toHaveLength(1);
  });
});

describe("notifications - isolation, list, mark", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  async function twoUsers() {
    const a = await seedUser(db, { email: "a@example.com", verified: true });
    const b = await seedUser(db, { email: "b@example.com", verified: true });
    return { a, b };
  }

  async function seedNote(userId: string, over: Record<string, unknown> = {}) {
    await create(db, bus, {
      userId,
      type: NotificationType.MENTION,
      payload: {
        boardId: "b1",
        cardId: "c1",
        actorHandle: "x",
        title: "T",
        ...over,
      },
    });
  }

  it("list returns only the caller's rows, newest-first", async () => {
    const { a, b } = await twoUsers();
    await seedNote(a.id, { title: "A1" });
    await seedNote(a.id, { title: "A2" });
    await seedNote(b.id, { title: "B1" });
    const page = await authedCaller(db, a.id).notifications.list({ limit: 20, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.items.map((i) => i.payload.title)).toEqual(["A2", "A1"]);
    expect(page.nextOffset).toBeNull();
  });

  it("unreadCount reflects unread rows and decrements after markRead", async () => {
    const { a } = await twoUsers();
    await seedNote(a.id);
    await seedNote(a.id);
    const caller = authedCaller(db, a.id);
    expect((await caller.notifications.unreadCount()).count).toBe(2);
    const page = await caller.notifications.list({ limit: 20, offset: 0 });
    await caller.notifications.markRead({ id: page.items[0].id });
    expect((await caller.notifications.unreadCount()).count).toBe(1);
  });

  it("markRead is idempotent on an already-read own row", async () => {
    const { a } = await twoUsers();
    await seedNote(a.id);
    const caller = authedCaller(db, a.id);
    const page = await caller.notifications.list({ limit: 20, offset: 0 });
    await caller.notifications.markRead({ id: page.items[0].id });
    await expect(
      caller.notifications.markRead({ id: page.items[0].id }),
    ).resolves.toEqual({ ok: true });
  });

  it("markRead on another user's id -> NOT_FOUND; row unchanged for owner", async () => {
    const { a, b } = await twoUsers();
    await seedNote(b.id);
    const bRow = (await rowsFor(db, b.id))[0];
    await expect(
      authedCaller(db, a.id).notifications.markRead({ id: bRow.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const after = (await rowsFor(db, b.id))[0];
    expect(after.read_at).toBeNull();
  });

  it("markRead on an unknown id -> NOT_FOUND", async () => {
    const { a } = await twoUsers();
    await expect(
      authedCaller(db, a.id).notifications.markRead({ id: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("markAllRead marks all the caller's rows, leaves others, second call -> 0", async () => {
    const { a, b } = await twoUsers();
    await seedNote(a.id);
    await seedNote(a.id);
    await seedNote(b.id);
    const caller = authedCaller(db, a.id);
    expect((await caller.notifications.markAllRead()).updated).toBe(2);
    expect((await caller.notifications.markAllRead()).updated).toBe(0);
    expect((await rowsFor(db, b.id))[0].read_at).toBeNull();
  });

  it("payload round-trips JSONB via list", async () => {
    const { a } = await twoUsers();
    await seedNote(a.id, { snippet: "hello world" });
    const page = await authedCaller(db, a.id).notifications.list({ limit: 20, offset: 0 });
    expect(page.items[0].payload).toEqual({
      boardId: "b1",
      cardId: "c1",
      actorHandle: "x",
      title: "T",
      snippet: "hello world",
    });
  });
});

describe("notifications - recorder is best-effort", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
    vi.restoreAllMocks();
  });

  it("invalid payload shape is logged, not inserted, does not throw, no publish", async () => {
    const a = await seedUser(db, { email: "a@example.com", verified: true });
    const errSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const pubSpy = vi.spyOn(bus, "publishUser");
    await expect(
      create(db, bus, {
        userId: a.id,
        type: NotificationType.MENTION,
        // missing boardId
        payload: { actorHandle: "x", title: "T" } as never,
      }),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    expect(pubSpy).not.toHaveBeenCalled();
    expect(await rowsFor(db, a.id)).toHaveLength(0);
  });

  it("comment action still succeeds when the notifications table is missing", async () => {
    const { user, board, card } = await ownerCard(db);
    const bob = await seedUser(db, { email: "bob@example.com", verified: true });
    await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
    await db.schema.dropTable("notifications").execute();
    const errSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const pubSpy = vi.spyOn(bus, "publishUser");
    const email = fakeEmail();
    const caller = createCaller(makeContext({ db, userId: user.id, email }));

    const c = await caller.comments.create({ cardId: card.id, body: "hey @bob" });
    expect(c.id).toBeDefined();
    expect(email.sent.filter((e) => e.type === "mention")).toHaveLength(1);
    expect(errSpy).toHaveBeenCalled();
    expect(pubSpy).not.toHaveBeenCalled();
  });
});

describe("notifications - publishUser nudge", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
    vi.restoreAllMocks();
  });

  it("create publishes exactly one nudge per recipient", async () => {
    const { user, board, column } = await ownerCard(db);
    const bob = await seedUser(db, { email: "bob@example.com", verified: true });
    await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
    const card = await seedCard(db, {
      columnId: column.id,
      position: 2,
      dueAt: new Date(Date.now() + 5 * 60_000),
      reminderMinutes: 60,
    });
    const pubSpy = vi.spyOn(bus, "publishUser");
    await runDueReminders(db, fakeEmail());
    const nudges = pubSpy.mock.calls.map((c) => c[0]);
    const recipients = nudges.map((n) => n.userId).sort();
    expect(recipients).toEqual([user.id, bob.id].sort());
    for (const n of nudges) expect(n.kind).toBe("notification");
  });
});
