import { AssigneeError, ProjectPermission, ProjectVisibility } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeEmail } from "../../auth/test/helpers.js";
import * as assigneeRepo from "../assignee.repo.js";
import { deleteCard } from "../../card/card.service.js";
import { fakeStorage } from "../../attachment/test/helpers.js";
import {
  authedCaller,
  createCaller,
  makeContext,
  newTestDb,
  seedAccess,
  seedBoard,
  seedBoardAccess,
  seedCard,
  seedColumn,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "./helpers.js";

async function ownerCard(db: TestDb) {
  const { user, caller } = await seedUserCaller(db, "owner@example.com");
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
  const column = await seedColumn(db, { boardId: board.id, position: 1 });
  const card = await seedCard(db, { columnId: column.id, position: 1 });
  return { user, caller, project, board, column, card };
}

describe("assignees", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  describe("assign (happy + idempotent + email)", () => {
    it("editor assigns a board member -> row + payload + one email", async () => {
      const { user, board, column, card } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
      const email = fakeEmail();
      const caller = createCaller(makeContext({ db, userId: user.id, email }));

      const list = await caller.assignees.assign({ cardId: card.id, userId: bob.id });
      expect(list.map((a) => a.email)).toContain("bob@example.com");

      const data = await caller.boards.getData({ id: board.id });
      const payloadCard = data.columns
        .find((c) => c.id === column.id)!
        .cards.find((c) => c.id === card.id)!;
      expect(payloadCard.assignees.map((a) => a.email)).toContain("bob@example.com");

      const mails = email.sent.filter((e) => e.type === "assigned");
      expect(mails).toHaveLength(1);
      expect(mails[0].to).toBe("bob@example.com");
      expect(mails[0].link).toContain(`card=${card.id}`);
    });

    it("re-assigning the same user is idempotent; email only on first", async () => {
      const { user, board, card } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
      const email = fakeEmail();
      const caller = createCaller(makeContext({ db, userId: user.id, email }));

      await caller.assignees.assign({ cardId: card.id, userId: bob.id });
      const list = await caller.assignees.assign({ cardId: card.id, userId: bob.id });
      expect(list.filter((a) => a.id === bob.id)).toHaveLength(1);
      expect(email.sent.filter((e) => e.type === "assigned")).toHaveLength(1);
    });

    it("self-assignment assigns but sends no email", async () => {
      const { user, card } = await ownerCard(db);
      const email = fakeEmail();
      const caller = createCaller(makeContext({ db, userId: user.id, email }));
      const list = await caller.assignees.assign({ cardId: card.id, userId: user.id });
      expect(list.map((a) => a.id)).toContain(user.id);
      expect(email.sent.filter((e) => e.type === "assigned")).toHaveLength(0);
    });

    it("assigns a user reachable via project_access (no board grant)", async () => {
      const { caller, project, card } = await ownerCard(db);
      const pm = await seedUser(db, { email: "pm@example.com", verified: true });
      await seedAccess(db, project.id, pm.id, ProjectPermission.Edit);
      const list = await caller.assignees.assign({ cardId: card.id, userId: pm.id });
      expect(list.map((a) => a.id)).toContain(pm.id);
    });
  });

  describe("assign (errors)", () => {
    it("view-only member -> FORBIDDEN", async () => {
      const { board, card } = await ownerCard(db);
      const viewer = await seedUser(db, { email: "v@example.com", verified: true });
      await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
      await expect(
        authedCaller(db, viewer.id).assignees.assign({
          cardId: card.id,
          userId: viewer.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("inaccessible board -> CARD_NOT_FOUND, no row, no email", async () => {
      const { card } = await ownerCard(db);
      const { user: stranger } = await seedUserCaller(db, "x@example.com");
      const email = fakeEmail();
      const caller = createCaller(makeContext({ db, userId: stranger.id, email }));
      await expect(
        caller.assignees.assign({ cardId: card.id, userId: stranger.id }),
      ).rejects.toMatchObject({ message: AssigneeError.CARD_NOT_FOUND });
      expect(await assigneeRepo.listByCard(db, card.id)).toHaveLength(0);
      expect(email.sent.filter((e) => e.type === "assigned")).toHaveLength(0);
    });

    it("non-existent userId -> USER_NOT_FOUND", async () => {
      const { caller, card } = await ownerCard(db);
      await expect(
        caller.assignees.assign({
          cardId: card.id,
          userId: "00000000-0000-0000-0000-000000000000",
        }),
      ).rejects.toMatchObject({ message: AssigneeError.USER_NOT_FOUND });
      expect(await assigneeRepo.listByCard(db, card.id)).toHaveLength(0);
    });

    it("real user with no grant -> NOT_BOARD_MEMBER", async () => {
      const { caller, card } = await ownerCard(db);
      const ghost = await seedUser(db, { email: "ghost@example.com", verified: true });
      await expect(
        caller.assignees.assign({ cardId: card.id, userId: ghost.id }),
      ).rejects.toMatchObject({ message: AssigneeError.NOT_BOARD_MEMBER });
      expect(await assigneeRepo.listByCard(db, card.id)).toHaveLength(0);
    });

    it("public-project viewer with no grant -> NOT_BOARD_MEMBER", async () => {
      const { user } = await seedUserCaller(db, "owner@example.com");
      const project = await seedProject(db, {
        ownerId: user.id,
        visibility: ProjectVisibility.Public,
      });
      const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
      const column = await seedColumn(db, { boardId: board.id, position: 1 });
      const card = await seedCard(db, { columnId: column.id, position: 1 });
      const viewer = await seedUser(db, { email: "pub@example.com", verified: true });
      // viewer can VIEW via public visibility, but is not an enumerable member.
      await expect(
        authedCaller(db, user.id).assignees.assign({
          cardId: card.id,
          userId: viewer.id,
        }),
      ).rejects.toMatchObject({ message: AssigneeError.NOT_BOARD_MEMBER });
    });
  });

  describe("list", () => {
    it("listForCard returns assignees ordered by email; no access -> CARD_NOT_FOUND", async () => {
      const { caller, board, card } = await ownerCard(db);
      const zoe = await seedUser(db, { email: "zoe@example.com", verified: true });
      const amy = await seedUser(db, { email: "amy@example.com", verified: true });
      await seedBoardAccess(db, board.id, zoe.id, ProjectPermission.Edit);
      await seedBoardAccess(db, board.id, amy.id, ProjectPermission.Edit);
      await caller.assignees.assign({ cardId: card.id, userId: zoe.id });
      await caller.assignees.assign({ cardId: card.id, userId: amy.id });
      const list = await caller.assignees.listForCard({ cardId: card.id });
      expect(list.map((a) => a.email)).toEqual(["amy@example.com", "zoe@example.com"]);

      const { user: stranger } = await seedUserCaller(db, "x@example.com");
      await expect(
        authedCaller(db, stranger.id).assignees.listForCard({ cardId: card.id }),
      ).rejects.toMatchObject({ message: AssigneeError.CARD_NOT_FOUND });
    });

    it("boardMembers returns the full assignable set deduped; no access -> BOARD_NOT_FOUND", async () => {
      const { user: owner, caller, project, board } = await ownerCard(db);
      const projectOwnerless = owner; // board owner == project owner here
      const bg = await seedUser(db, { email: "bg@example.com", verified: true });
      const pg = await seedUser(db, { email: "pg@example.com", verified: true });
      await seedBoardAccess(db, board.id, bg.id, ProjectPermission.Edit);
      await seedAccess(db, project.id, pg.id, ProjectPermission.Edit);
      const members = await caller.assignees.boardMembers({ boardId: board.id });
      const emails = members.map((m) => m.email).sort();
      expect(emails).toEqual(
        ["bg@example.com", "owner@example.com", "pg@example.com"].sort(),
      );
      expect(projectOwnerless).toBeTruthy();

      const { user: stranger } = await seedUserCaller(db, "x@example.com");
      await expect(
        authedCaller(db, stranger.id).assignees.boardMembers({ boardId: board.id }),
      ).rejects.toMatchObject({ message: AssigneeError.BOARD_NOT_FOUND });
    });
  });

  describe("unassign", () => {
    it("editor unassigns -> row gone, no email", async () => {
      const { user, board, card } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
      const email = fakeEmail();
      const caller = createCaller(makeContext({ db, userId: user.id, email }));
      await caller.assignees.assign({ cardId: card.id, userId: bob.id });
      email.clear();
      const list = await caller.assignees.unassign({ cardId: card.id, userId: bob.id });
      expect(list.map((a) => a.id)).not.toContain(bob.id);
      expect(email.sent.filter((e) => e.type === "assigned")).toHaveLength(0);
    });

    it("unassigning a non-assignee is an idempotent success", async () => {
      const { caller, board, card } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
      const list = await caller.assignees.unassign({ cardId: card.id, userId: bob.id });
      expect(list).toHaveLength(0);
    });

    it("view-only member -> FORBIDDEN", async () => {
      const { board, card } = await ownerCard(db);
      const viewer = await seedUser(db, { email: "v@example.com", verified: true });
      await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
      await expect(
        authedCaller(db, viewer.id).assignees.unassign({
          cardId: card.id,
          userId: viewer.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("inaccessible board -> CARD_NOT_FOUND", async () => {
      const { card } = await ownerCard(db);
      const { user: stranger } = await seedUserCaller(db, "x@example.com");
      await expect(
        authedCaller(db, stranger.id).assignees.unassign({
          cardId: card.id,
          userId: stranger.id,
        }),
      ).rejects.toMatchObject({ message: AssigneeError.CARD_NOT_FOUND });
    });
  });

  describe("enrichment / no N+1", () => {
    it("getData populates assignees via a single batched query", async () => {
      const { user, caller, board, column } = await ownerCard(db);
      const c1 = await seedCard(db, { columnId: column.id, position: 2 });
      const c2 = await seedCard(db, { columnId: column.id, position: 3 });
      await caller.assignees.assign({ cardId: c1.id, userId: user.id });

      const spy = vi.spyOn(assigneeRepo, "listForCards");
      const data = await caller.boards.getData({ id: board.id });
      const cards = data.columns.find((c) => c.id === column.id)!.cards;
      expect(cards.find((c) => c.id === c1.id)!.assignees).toHaveLength(1);
      expect(cards.find((c) => c.id === c2.id)!.assignees).toHaveLength(0);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  describe("cascade", () => {
    it("deleteCard removes its assignee rows", async () => {
      const { user, caller, card } = await ownerCard(db);
      await caller.assignees.assign({ cardId: card.id, userId: user.id });
      await deleteCard(db, fakeStorage(), { id: user.id, isSuperuser: false }, card.id);
      expect(await assigneeRepo.listByCard(db, card.id)).toHaveLength(0);
    });

    it("deleting a user removes their assignee rows", async () => {
      const { board, card, caller } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
      await caller.assignees.assign({ cardId: card.id, userId: bob.id });
      await db.deleteFrom("users").where("id", "=", bob.id).execute();
      expect(await assigneeRepo.listByCard(db, card.id)).toHaveLength(0);
    });

    it("accessRevoke unassigns the user from that board only; no email", async () => {
      const { user, caller, board, card } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
      // a second board where bob is also assigned, to prove scope isolation.
      const project2 = await seedProject(db, { ownerId: user.id });
      const board2 = await seedBoard(db, { projectId: project2.id, ownerId: user.id });
      const col2 = await seedColumn(db, { boardId: board2.id, position: 1 });
      const card2 = await seedCard(db, { columnId: col2.id, position: 1 });
      await seedBoardAccess(db, board2.id, bob.id, ProjectPermission.Edit);

      const email = fakeEmail();
      const ctxCaller = createCaller(makeContext({ db, userId: user.id, email }));
      await ctxCaller.assignees.assign({ cardId: card.id, userId: bob.id });
      await ctxCaller.assignees.assign({ cardId: card2.id, userId: bob.id });
      email.clear();

      await caller.boards.accessRevoke({ id: board.id, userId: bob.id });
      expect(await assigneeRepo.listByCard(db, card.id)).toHaveLength(0);
      expect((await assigneeRepo.listByCard(db, card2.id)).map((a) => a.id)).toContain(
        bob.id,
      );
      expect(email.sent.filter((e) => e.type === "assigned")).toHaveLength(0);
    });

    it("re-grant does not restore old assignments", async () => {
      const { user, caller, board, card } = await ownerCard(db);
      const bob = await seedUser(db, { email: "bob@example.com", verified: true });
      await seedBoardAccess(db, board.id, bob.id, ProjectPermission.Edit);
      await authedCaller(db, user.id).assignees.assign({
        cardId: card.id,
        userId: bob.id,
      });
      await caller.boards.accessRevoke({ id: board.id, userId: bob.id });
      await caller.boards.accessGrant({
        id: board.id,
        email: "bob@example.com",
        permission: ProjectPermission.Edit,
      });
      expect(await assigneeRepo.listByCard(db, card.id)).toHaveLength(0);
    });
  });
});
