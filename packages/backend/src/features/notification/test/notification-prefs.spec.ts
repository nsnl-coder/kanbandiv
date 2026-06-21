import { NotificationType, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeEmail } from "../../auth/test/helpers.js";
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

async function ownerBoard(db: TestDb) {
  const { user, caller } = await seedUserCaller(db, "owner@example.com");
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
  const column = await seedColumn(db, { boardId: board.id, position: 1 });
  const card = await seedCard(db, { columnId: column.id, position: 1 });
  return { user, caller, board, column, card };
}

function rowsFor(db: TestDb, userId: string) {
  return db
    .selectFrom("notifications")
    .selectAll()
    .where("user_id", "=", userId)
    .execute();
}

describe("notification prefs - list/set", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("prefsList returns all 3 types defaulting on/on", async () => {
    const a = await seedUser(db, { email: "a@example.com", verified: true });
    const prefs = await authedCaller(db, a.id).notifications.prefsList();
    expect(prefs).toHaveLength(3);
    for (const p of prefs) {
      expect(p.inApp).toBe(true);
      expect(p.email).toBe(true);
    }
    expect(prefs.map((p) => p.type).sort()).toEqual(
      Object.values(NotificationType).sort(),
    );
  });

  it("prefsSet upserts and is reflected by prefsList; other types untouched", async () => {
    const a = await seedUser(db, { email: "a@example.com", verified: true });
    const caller = authedCaller(db, a.id);
    await caller.notifications.prefsSet({
      type: NotificationType.CARD_ASSIGNED,
      inApp: false,
      email: false,
    });
    const prefs = await caller.notifications.prefsList();
    const assigned = prefs.find((p) => p.type === NotificationType.CARD_ASSIGNED);
    const mention = prefs.find((p) => p.type === NotificationType.MENTION);
    expect(assigned).toMatchObject({ inApp: false, email: false });
    expect(mention).toMatchObject({ inApp: true, email: true });
  });

  it("prefsSet twice updates in place (no duplicate rows)", async () => {
    const a = await seedUser(db, { email: "a@example.com", verified: true });
    const caller = authedCaller(db, a.id);
    await caller.notifications.prefsSet({ type: NotificationType.MENTION, inApp: false, email: true });
    await caller.notifications.prefsSet({ type: NotificationType.MENTION, inApp: true, email: false });
    const rows = await db
      .selectFrom("notification_prefs")
      .selectAll()
      .where("user_id", "=", a.id)
      .where("type", "=", NotificationType.MENTION)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ in_app: true, email: false });
  });
});

describe("notification prefs - gating delivery", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("muting in_app skips the inbox row but email still sends", async () => {
    const { user, board, card } = await ownerBoard(db);
    const bob = await seedUser(db, { email: "bob@example.com", verified: true });
    await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
    await authedCaller(db, bob.id).notifications.prefsSet({
      type: NotificationType.MENTION,
      inApp: false,
      email: true,
    });

    const email = fakeEmail();
    const caller = createCaller(makeContext({ db, userId: user.id, email }));
    await caller.comments.create({ cardId: card.id, body: "ping @bob" });

    expect(await rowsFor(db, bob.id)).toHaveLength(0);
    expect(email.sent.filter((e) => e.type === "mention")).toHaveLength(1);
  });

  it("muting email skips the send but the inbox row is still recorded", async () => {
    const { user, board, card } = await ownerBoard(db);
    const bob = await seedUser(db, { email: "bob@example.com", verified: true });
    await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
    await authedCaller(db, bob.id).notifications.prefsSet({
      type: NotificationType.MENTION,
      inApp: true,
      email: false,
    });

    const email = fakeEmail();
    const caller = createCaller(makeContext({ db, userId: user.id, email }));
    await caller.comments.create({ cardId: card.id, body: "ping @bob" });

    expect(await rowsFor(db, bob.id)).toHaveLength(1);
    expect(email.sent.filter((e) => e.type === "mention")).toHaveLength(0);
  });

  it("muting one type leaves another type's delivery intact", async () => {
    const { user, board, card } = await ownerBoard(db);
    const bob = await seedUser(db, { email: "bob@example.com", verified: true });
    await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
    // Mute MENTION entirely; CARD_ASSIGNED stays default-on.
    await authedCaller(db, bob.id).notifications.prefsSet({
      type: NotificationType.MENTION,
      inApp: false,
      email: false,
    });

    const email = fakeEmail();
    const caller = createCaller(makeContext({ db, userId: user.id, email }));
    await caller.comments.create({ cardId: card.id, body: "ping @bob" });
    await caller.assignees.assign({ cardId: card.id, userId: bob.id });

    const rows = await rowsFor(db, bob.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(NotificationType.CARD_ASSIGNED);
    expect(email.sent.filter((e) => e.type === "mention")).toHaveLength(0);
    expect(email.sent.filter((e) => e.type === "assigned")).toHaveLength(1);
  });
});
