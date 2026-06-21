import { InviteScope, ProjectError, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeEmail } from "../../auth/test/helpers.js";
import {
  authedCaller,
  createCaller,
  makeContext,
  newTestDb,
  seedAccess,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "./helpers.js";

describe("projects.accessGrant", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("lets the owner grant view access by email", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const member = await seedUser(db, { email: "m@example.com", verified: true });
    const p = await seedProject(db, { ownerId: user.id });

    const res = await caller.projects.accessGrant({
      id: p.id,
      email: "m@example.com",
      permission: ProjectPermission.View,
    });
    expect(res).toEqual([
      { userId: member.id, email: "m@example.com", permission: ProjectPermission.View },
    ]);
  });

  it("upserts an existing grant to a new permission", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const member = await seedUser(db, { email: "m@example.com", verified: true });
    const p = await seedProject(db, { ownerId: user.id });
    await seedAccess(db, p.id, member.id, ProjectPermission.View);

    const res = await caller.projects.accessGrant({
      id: p.id,
      email: "m@example.com",
      permission: ProjectPermission.Edit,
    });
    expect(res).toHaveLength(1);
    expect(res[0].permission).toBe(ProjectPermission.Edit);
  });

  it("rejects granting access to the owner", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const p = await seedProject(db, { ownerId: user.id });
    await expect(
      caller.projects.accessGrant({
        id: p.id,
        email: "owner@example.com",
        permission: ProjectPermission.Edit,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: ProjectError.CANNOT_GRANT_OWNER,
    });
  });

  it("an unknown target email creates a pending invite + sends invite mail", async () => {
    const user = await seedUser(db, { email: "owner@example.com", verified: true });
    const p = await seedProject(db, { ownerId: user.id });
    const email = fakeEmail();
    const caller = createCaller(makeContext({ db, userId: user.id, email }));

    const res = await caller.projects.accessGrant({
      id: p.id,
      email: "ghost@example.com",
      permission: ProjectPermission.Edit,
    });

    expect(res).toEqual([]);
    expect(email.sent.filter((e) => e.type === "invite")).toHaveLength(1);

    const invites = await caller.invites.listForScope({
      scope: InviteScope.Project,
      scopeId: p.id,
    });
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({
      email: "ghost@example.com",
      permission: ProjectPermission.Edit,
    });
  });

  it("forbids a non-owner (editor) from granting", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const editor = await seedUser(db, { email: "e@example.com", verified: true });
    await seedUser(db, { email: "t@example.com", verified: true });
    const p = await seedProject(db, { ownerId: owner.id });
    await seedAccess(db, p.id, editor.id, ProjectPermission.Edit);
    await expect(
      authedCaller(db, editor.id).projects.accessGrant({
        id: p.id,
        email: "t@example.com",
        permission: ProjectPermission.View,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
