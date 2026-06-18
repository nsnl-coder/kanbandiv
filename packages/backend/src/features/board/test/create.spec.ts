import { DEFAULT_BOARD_COLOR, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authedCaller,
  newTestDb,
  seedAccess,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "./helpers.js";

describe("boards.create", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("makes the creator the board owner", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const project = await seedProject(db, { ownerId: user.id });
    const res = await caller.boards.create({
      projectId: project.id,
      name: "Sprint",
    });
    expect(res.ownerId).toBe(user.id);
    expect(res.projectId).toBe(project.id);
    expect(res.myPermission).toBe("owner");
    expect(res.color).toBe(DEFAULT_BOARD_COLOR);
  });

  it("lets a project edit-grantee create a board", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const editor = await seedUser(db, { email: "e@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    await seedAccess(db, project.id, editor.id, ProjectPermission.Edit);
    const res = await authedCaller(db, editor.id).boards.create({
      projectId: project.id,
      name: "Sprint",
    });
    expect(res.ownerId).toBe(editor.id);
  });

  it("forbids a project view-only grantee from creating", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    await seedAccess(db, project.id, viewer.id, ProjectPermission.View);
    await expect(
      authedCaller(db, viewer.id).boards.create({
        projectId: project.id,
        name: "Sprint",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns NOT_FOUND when the caller has no project access", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const project = await seedProject(db, { ownerId: owner.id });
    const { caller } = await seedUserCaller(db, "stranger@example.com");
    await expect(
      caller.boards.create({ projectId: project.id, name: "Sprint" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
