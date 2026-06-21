import { InviteScope, OtpPurpose, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeEmail, seedOtp } from "../../auth/test/helpers.js";
import {
  authedCaller,
  createCaller,
  makeContext,
  newTestDb,
  seedBoard,
  seedProject,
  seedUser,
  type TestDb,
} from "../../board/test/helpers.js";

function boardAccessFor(db: TestDb, boardId: string, userId: string) {
  return db
    .selectFrom("board_access")
    .selectAll()
    .where("board_id", "=", boardId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
}

function projectAccessFor(db: TestDb, projectId: string, userId: string) {
  return db
    .selectFrom("project_access")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
}

function pendingInvites(db: TestDb, scopeId: string) {
  return db
    .selectFrom("invites")
    .selectAll()
    .where("scope_id", "=", scopeId)
    .execute();
}

describe("invites - lifecycle", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("signup+verify turns a pending board invite into a real grant", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    const email = fakeEmail();
    const ownerCaller = createCaller(makeContext({ db, userId: owner.id, email }));

    await ownerCaller.boards.accessGrant({
      id: board.id,
      email: "ghost@example.com",
      permission: ProjectPermission.Edit,
    });
    expect(await pendingInvites(db, board.id)).toHaveLength(1);

    // ghost signs up + verifies (invite is consumed on verify).
    const ghost = await seedUser(db, { email: "ghost@example.com", verified: false });
    const code = await seedOtp(db, { userId: ghost.id, purpose: OtpPurpose.VerifyEmail });
    await createCaller(makeContext({ db, email })).auth.verifyEmail({
      email: "ghost@example.com",
      otp: code,
    });

    const access = await boardAccessFor(db, board.id, ghost.id);
    expect(access?.permission).toBe(ProjectPermission.Edit);
    expect(await pendingInvites(db, board.id)).toHaveLength(0);
  });

  it("signup+verify turns a pending project invite into a real grant", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const email = fakeEmail();
    const ownerCaller = createCaller(makeContext({ db, userId: owner.id, email }));

    await ownerCaller.projects.accessGrant({
      id: project.id,
      email: "ghost@example.com",
      permission: ProjectPermission.View,
    });

    const ghost = await seedUser(db, { email: "ghost@example.com", verified: false });
    const code = await seedOtp(db, { userId: ghost.id, purpose: OtpPurpose.VerifyEmail });
    await createCaller(makeContext({ db, email })).auth.verifyEmail({
      email: "ghost@example.com",
      otp: code,
    });

    const access = await projectAccessFor(db, project.id, ghost.id);
    expect(access?.permission).toBe(ProjectPermission.View);
    expect(await pendingInvites(db, project.id)).toHaveLength(0);
  });

  it("a known email grants immediately and creates NO invite", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const member = await seedUser(db, { email: "m@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    const email = fakeEmail();
    const ownerCaller = createCaller(makeContext({ db, userId: owner.id, email }));

    await ownerCaller.boards.accessGrant({
      id: board.id,
      email: "m@example.com",
      permission: ProjectPermission.Edit,
    });

    expect(await boardAccessFor(db, board.id, member.id)).toBeDefined();
    expect(await pendingInvites(db, board.id)).toHaveLength(0);
    expect(email.sent.filter((e) => e.type === "invite")).toHaveLength(0);
  });

  it("re-inviting the same email updates the permission in place (one row)", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    const email = fakeEmail();
    const ownerCaller = createCaller(makeContext({ db, userId: owner.id, email }));

    await ownerCaller.boards.accessGrant({
      id: board.id,
      email: "ghost@example.com",
      permission: ProjectPermission.View,
    });
    await ownerCaller.boards.accessGrant({
      id: board.id,
      email: "ghost@example.com",
      permission: ProjectPermission.Edit,
    });

    const invites = await ownerCaller.invites.listForScope({
      scope: InviteScope.Board,
      scopeId: board.id,
    });
    expect(invites).toHaveLength(1);
    expect(invites[0].permission).toBe(ProjectPermission.Edit);
  });

  it("the owner can revoke a pending invite", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });
    const email = fakeEmail();
    const ownerCaller = createCaller(makeContext({ db, userId: owner.id, email }));

    await ownerCaller.boards.accessGrant({
      id: board.id,
      email: "ghost@example.com",
      permission: ProjectPermission.Edit,
    });
    const [invite] = await ownerCaller.invites.listForScope({
      scope: InviteScope.Board,
      scopeId: board.id,
    });
    await ownerCaller.invites.revoke({ id: invite.id });

    expect(await pendingInvites(db, board.id)).toHaveLength(0);
  });

  it("a non-owner cannot list a scope's invites", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const stranger = await seedUser(db, { email: "s@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: owner.id });

    await expect(
      authedCaller(db, stranger.id).invites.listForScope({
        scope: InviteScope.Board,
        scopeId: board.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
