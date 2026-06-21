import { Readable } from "node:stream";
import { AttachmentError, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "../attachment.repo.js";
import {
  createAttachment,
  deleteAttachment,
  listAttachments,
} from "../attachment.service.js";
import {
  fakeStorage,
  newTestDb,
  seedBoard,
  seedBoardAccess,
  seedCard,
  seedColumn,
  seedProject,
  seedUser,
  type TestDb,
} from "./helpers.js";

const ctx = (id: string) => ({ id, isSuperuser: false });

async function ownerBoardCard(db: TestDb, email = "owner@example.com") {
  const user = await seedUser(db, { email, verified: true });
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
  const column = await seedColumn(db, { boardId: board.id, position: 1 });
  const card = await seedCard(db, { columnId: column.id, position: 1 });
  return { user, board, column, card };
}

function upload(stream = Readable.from(Buffer.from("hello")), over: Partial<{ filename: string; mimeType: string }> = {}) {
  return {
    filename: over.filename ?? "pic.png",
    mimeType: over.mimeType ?? "image/png",
    stream,
  };
}

describe("attachment service", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("editor uploads: inserts a row and puts a sanitized key (no raw filename)", async () => {
    const { user, card } = await ownerBoardCard(db);
    const storage = fakeStorage();
    const res = await createAttachment(db, storage, ctx(user.id), {
      ...upload(Readable.from(Buffer.from("../../etc/passwd-data")), { filename: "../../etc/passwd.png" }),
      cardId: card.id,
    });
    expect(res.cardId).toBe(card.id);
    expect(res.sizeBytes).toBe(Buffer.from("../../etc/passwd-data").length);
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0].key).toBe(`cards/${card.id}/${res.id}.png`);
    expect(storage.puts[0].key).not.toContain("passwd");
    expect(res.downloadUrl).toBe(`/api/attachments/${res.id}/download`);
  });

  it("view-only member cannot upload (CARD_NOT_FOUND, no leak)", async () => {
    const { board, card } = await ownerBoardCard(db);
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
    const storage = fakeStorage();
    await expect(
      createAttachment(db, storage, ctx(viewer.id), { ...upload(), cardId: card.id }),
    ).rejects.toMatchObject({ message: AttachmentError.CARD_NOT_FOUND });
    expect(storage.puts).toHaveLength(0);
  });

  it("rejects an unsupported mime type", async () => {
    const { user, card } = await ownerBoardCard(db);
    const storage = fakeStorage();
    await expect(
      createAttachment(db, storage, ctx(user.id), {
        ...upload(Readable.from(Buffer.from("<svg/>")), { mimeType: "image/svg+xml" }),
        cardId: card.id,
      }),
    ).rejects.toMatchObject({ message: AttachmentError.UNSUPPORTED_TYPE });
    expect(storage.puts).toHaveLength(0);
  });

  it("rejects an over-long filename", async () => {
    const { user, card } = await ownerBoardCard(db);
    const storage = fakeStorage();
    await expect(
      createAttachment(db, storage, ctx(user.id), {
        ...upload(Readable.from(Buffer.from("x")), { filename: "a".repeat(256) + ".png" }),
        cardId: card.id,
      }),
    ).rejects.toMatchObject({ message: AttachmentError.FILENAME_TOO_LONG });
  });

  it("rejects an oversize stream and removes the object (no row)", async () => {
    const { user, card } = await ownerBoardCard(db);
    const storage = fakeStorage();
    const big = Readable.from(Buffer.alloc(10485761));
    await expect(
      createAttachment(db, storage, ctx(user.id), { ...upload(big), cardId: card.id }),
    ).rejects.toMatchObject({ message: AttachmentError.FILE_TOO_LARGE });
    expect(storage.removed).toHaveLength(1);
    expect(await repo.listByCard(db, card.id)).toHaveLength(0);
  });

  it("storage disabled -> STORAGE_UNAVAILABLE, no row, no put", async () => {
    const { user, card } = await ownerBoardCard(db);
    const storage = fakeStorage({ enabled: false });
    await expect(
      createAttachment(db, storage, ctx(user.id), { ...upload(), cardId: card.id }),
    ).rejects.toMatchObject({ message: AttachmentError.STORAGE_UNAVAILABLE });
    expect(storage.puts).toHaveLength(0);
    expect(await repo.listByCard(db, card.id)).toHaveLength(0);
  });

  it("removes the object when the DB insert fails (no orphan)", async () => {
    const { user, card } = await ownerBoardCard(db);
    const storage = fakeStorage();
    const spy = vi.spyOn(repo, "create").mockRejectedValueOnce(new Error("db down"));
    await expect(
      createAttachment(db, storage, ctx(user.id), { ...upload(), cardId: card.id }),
    ).rejects.toThrow("db down");
    expect(storage.removed).toHaveLength(1);
    spy.mockRestore();
  });

  it("lists a card's attachments ordered by created_at asc", async () => {
    const { user, card } = await ownerBoardCard(db);
    const storage = fakeStorage();
    await createAttachment(db, storage, ctx(user.id), { ...upload(Readable.from(Buffer.from("a"))), cardId: card.id });
    await createAttachment(db, storage, ctx(user.id), { ...upload(Readable.from(Buffer.from("bb"))), cardId: card.id });
    const list = await listAttachments(db, ctx(user.id), { cardId: card.id });
    expect(list).toHaveLength(2);
    expect(list[0].sizeBytes).toBe(1);
    expect(list[1].sizeBytes).toBe(2);
  });

  it("list on an inaccessible board -> CARD_NOT_FOUND (no leak)", async () => {
    const { card } = await ownerBoardCard(db);
    const stranger = await seedUser(db, { email: "s@example.com", verified: true });
    await expect(
      listAttachments(db, ctx(stranger.id), { cardId: card.id }),
    ).rejects.toMatchObject({ message: AttachmentError.CARD_NOT_FOUND });
  });

  it("uploader (non-owner) can delete; object removed then row gone", async () => {
    const { user, board, card } = await ownerBoardCard(db);
    const editor = await seedUser(db, { email: "e@example.com", verified: true });
    await seedBoardAccess(db, board.id, editor.id, ProjectPermission.Edit);
    const storage = fakeStorage();
    const att = await createAttachment(db, storage, ctx(editor.id), { ...upload(), cardId: card.id });
    void user;
    const res = await deleteAttachment(db, storage, ctx(editor.id), { id: att.id });
    expect(res.ok).toBe(true);
    expect(storage.removed).toContain(`cards/${card.id}/${att.id}.png`);
    expect(await repo.findById(db, att.id)).toBeUndefined();
  });

  it("board owner (non-uploader) can delete", async () => {
    const { user, board, card } = await ownerBoardCard(db);
    const editor = await seedUser(db, { email: "e@example.com", verified: true });
    await seedBoardAccess(db, board.id, editor.id, ProjectPermission.Edit);
    const storage = fakeStorage();
    const att = await createAttachment(db, storage, ctx(editor.id), { ...upload(), cardId: card.id });
    await expect(deleteAttachment(db, storage, ctx(user.id), { id: att.id })).resolves.toEqual({ ok: true });
  });

  it("an editor who is neither uploader nor owner -> FORBIDDEN", async () => {
    const { user, board, card } = await ownerBoardCard(db);
    const e1 = await seedUser(db, { email: "e1@example.com", verified: true });
    const e2 = await seedUser(db, { email: "e2@example.com", verified: true });
    await seedBoardAccess(db, board.id, e1.id, ProjectPermission.Edit);
    await seedBoardAccess(db, board.id, e2.id, ProjectPermission.Edit);
    const storage = fakeStorage();
    const att = await createAttachment(db, storage, ctx(e1.id), { ...upload(), cardId: card.id });
    void user;
    await expect(
      deleteAttachment(db, storage, ctx(e2.id), { id: att.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("already-missing object still deletes the row", async () => {
    const { user, card } = await ownerBoardCard(db);
    const storage = fakeStorage();
    const att = await createAttachment(db, storage, ctx(user.id), { ...upload(), cardId: card.id });
    storage.failNextRemove = true;
    await expect(deleteAttachment(db, storage, ctx(user.id), { id: att.id })).resolves.toEqual({ ok: true });
    expect(await repo.findById(db, att.id)).toBeUndefined();
  });

  it("unknown id -> ATTACHMENT_NOT_FOUND", async () => {
    const { user } = await ownerBoardCard(db);
    const storage = fakeStorage();
    await expect(
      deleteAttachment(db, storage, ctx(user.id), { id: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ message: AttachmentError.ATTACHMENT_NOT_FOUND });
  });
});
