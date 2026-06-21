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
