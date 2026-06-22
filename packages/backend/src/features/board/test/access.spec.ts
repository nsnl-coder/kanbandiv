import { BoardError, InviteScope, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeEmail } from "../../auth/test/helpers.js";
import {
  authedCaller,
  createCaller,
  makeContext,
  newTestDb,
  seedBoard,
  seedBoardAccess,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "./helpers.js";

describe("boards access grant/revoke", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("lets the owner grant access by email", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const member = await seedUser(db, { email: "m@example.com", verified: true });
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
    const res = await caller.boards.accessGrant({
      id: board.id,
      email: "m@example.com",
      permission: ProjectPermission.Edit,
    });
    expect(res).toEqual([
      { userId: member.id, email: "m@example.com", permission: ProjectPermission.Edit },
    ]);
  });

  it("lists and revokes grants", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const member = await seedUser(db, { email: "m@example.com", verified: true });
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
    await seedBoardAccess(db, board.id, member.id, ProjectPermission.View);
    expect(await caller.boards.accessList({ id: board.id })).toHaveLength(1);
    const res = await caller.boards.accessRevoke({
      id: board.id,
      userId: member.id,
    });
    expect(res).toEqual([]);
  });

  it("rejects granting access to the board owner", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
    await expect(
      caller.boards.accessGrant({
        id: board.id,
        email: "owner@example.com",
        permission: ProjectPermission.Edit,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: BoardError.CANNOT_GRANT_OWNER,
    });
  });

  it("an unknown email creates a pending invite + sends invite mail, no grant added", async () => {
    const user = await seedUser(db, { email: "owner@example.com", verified: true });
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
    const email = fakeEmail();
    const caller = createCaller(makeContext({ db, userId: user.id, email }));

    const res = await caller.boards.accessGrant({
      id: board.id,
      email: "ghost@example.com",
      permission: ProjectPermission.Edit,
    });

    // No active grant yet (account does not exist).
    expect(res).toEqual([]);
    expect(email.sent.filter((e) => e.type === "invite")).toHaveLength(1);

    const invites = await caller.invites.listForScope({
      scope: InviteScope.Board,
      scopeId: board.id,
    });
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({
      email: "ghost@example.com",
      permission: ProjectPermission.Edit,
    });
  });

  it("surfaces the parent project in the recipient's shared list + notifies them", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const member = await seedUser(db, { email: "m@example.com", verified: true });
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });

    await caller.boards.accessGrant({
      id: board.id,
      email: "m@example.com",
      permission: ProjectPermission.Edit,
    });

    const memberCaller = authedCaller(db, member.id);
    const shared = await memberCaller.projects.list({ filter: "shared", limit: 100, offset: 0 });
    expect(shared.map((p) => p.id)).toContain(project.id);

    // The member sees only the shared board inside that project, not all boards.
    const boards = await memberCaller.boards.list({ projectId: project.id });
    expect(boards.map((b) => b.id)).toEqual([board.id]);

    const notes = await memberCaller.notifications.list({ limit: 20, offset: 0 });
    expect(notes.items.some((n) => n.type === "BOARD_SHARED")).toBe(true);
  });

  it("forbids a non-owner from granting", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const editor = await seedUser(db, { email: "e@example.com", verified: true });
    await seedUser(db, { email: "t@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    await seedBoardAccess(db, board.id, editor.id, ProjectPermission.Edit);
    await expect(
      authedCaller(db, editor.id).boards.accessGrant({
        id: board.id,
        email: "t@example.com",
        permission: ProjectPermission.View,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
