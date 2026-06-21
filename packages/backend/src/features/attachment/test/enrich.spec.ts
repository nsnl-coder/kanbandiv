import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "../attachment.repo.js";
import { createAttachment } from "../attachment.service.js";
import { deleteCard } from "../../card/card.service.js";
import {
  fakeStorage,
  newTestDb,
  seedBoard,
  seedCard,
  seedColumn,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "./helpers.js";

const ctx = (id: string) => ({ id, isSuperuser: false });

describe("attachment count enrichment + card delete cleanup", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("card payload carries attachmentCount via a single batched query (no N+1)", async () => {
    const { user, caller } = await seedUserCaller(db, "owner@example.com");
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
    const column = await seedColumn(db, { boardId: board.id, position: 1 });
    const c1 = await seedCard(db, { columnId: column.id, position: 1 });
    const c2 = await seedCard(db, { columnId: column.id, position: 2 });
    const storage = fakeStorage();
    await createAttachment(db, storage, ctx(user.id), {
      cardId: c1.id,
      filename: "a.png",
      mimeType: "image/png",
      stream: Readable.from(Buffer.from("a")),
    });
    await createAttachment(db, storage, ctx(user.id), {
      cardId: c1.id,
      filename: "b.png",
      mimeType: "image/png",
      stream: Readable.from(Buffer.from("b")),
    });

    const countSpy = vi.spyOn(repo, "countByCards");
    const data = await caller.boards.getData({ id: board.id });
    const cards = data.columns[0].cards;
    expect(cards.find((c) => c.id === c1.id)?.attachmentCount).toBe(2);
    expect(cards.find((c) => c.id === c2.id)?.attachmentCount).toBe(0);
    expect(countSpy).toHaveBeenCalledTimes(1);
    countSpy.mockRestore();
  });

  it("deleteCard removes attachment rows (cascade) and calls removePrefix", async () => {
    const { user } = await seedUserCaller(db, "owner@example.com");
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
    const column = await seedColumn(db, { boardId: board.id, position: 1 });
    const card = await seedCard(db, { columnId: column.id, position: 1 });
    const storage = fakeStorage();
    await createAttachment(db, storage, ctx(user.id), {
      cardId: card.id,
      filename: "a.png",
      mimeType: "image/png",
      stream: Readable.from(Buffer.from("a")),
    });

    await deleteCard(db, storage, ctx(user.id), card.id);
    expect(storage.removedPrefixes).toContain(`cards/${card.id}/`);
    expect(await repo.listByCard(db, card.id)).toHaveLength(0);
  });
});
