import express from "express";
import request from "supertest";
import { ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "../../auth/auth.service.js";
import { createAttachmentHttpRouter } from "../attachment.http.js";
import {
  fakeStorage,
  newTestDb,
  seedBoard,
  seedBoardAccess,
  seedCard,
  seedColumn,
  seedProject,
  seedUser,
  type FakeStorage,
  type TestDb,
} from "./helpers.js";

function tokenFor(user: { id: string; email: string }) {
  return signAccessToken({ id: user.id, email: user.email } as never);
}

function app(db: TestDb, storage: FakeStorage) {
  const a = express();
  a.use("/api", createAttachmentHttpRouter({ db: db as never, storage }));
  return a;
}

describe("attachment http routes", () => {
  let db: TestDb;
  let storage: FakeStorage;

  beforeEach(async () => {
    db = await newTestDb();
    storage = fakeStorage();
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function ownerSetup() {
    const user = await seedUser(db, { email: "owner@example.com", verified: true });
    const project = await seedProject(db, { ownerId: user.id });
    const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
    const column = await seedColumn(db, { boardId: board.id, position: 1 });
    const card = await seedCard(db, { columnId: column.id, position: 1 });
    return { user, board, card };
  }

  const cookie = (user: { id: string; email: string }) => `access_token=${tokenFor(user)}`;

  it("uploads a file -> 201 with attachment payload", async () => {
    const { user, card } = await ownerSetup();
    const res = await request(app(db, storage))
      .post(`/api/cards/${card.id}/attachments`)
      .set("Cookie", cookie(user))
      .set("x-requested-with", "XMLHttpRequest")
      .attach("file", Buffer.from("hello world"), { filename: "doc.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.cardId).toBe(card.id);
    expect(res.body.sizeBytes).toBe(11);
    expect(res.body.downloadUrl).toBe(`/api/attachments/${res.body.id}/download`);
  });

  it("aborts an over-cap stream mid-stream -> 413 (not fully buffered)", async () => {
    const { user, card } = await ownerSetup();
    const big = Buffer.alloc(10485761);
    const res = await request(app(db, storage))
      .post(`/api/cards/${card.id}/attachments`)
      .set("Cookie", cookie(user))
      .set("x-requested-with", "XMLHttpRequest")
      .attach("file", big, { filename: "big.png", contentType: "image/png" });
    expect(res.status).toBe(413);
  });

  it("rejects a bad mime type -> 415", async () => {
    const { user, card } = await ownerSetup();
    const res = await request(app(db, storage))
      .post(`/api/cards/${card.id}/attachments`)
      .set("Cookie", cookie(user))
      .set("x-requested-with", "XMLHttpRequest")
      .attach("file", Buffer.from("<svg/>"), { filename: "x.svg", contentType: "image/svg+xml" });
    expect(res.status).toBe(415);
  });

  it("missing file part -> 400", async () => {
    const { user, card } = await ownerSetup();
    const res = await request(app(db, storage))
      .post(`/api/cards/${card.id}/attachments`)
      .set("Cookie", cookie(user))
      .set("x-requested-with", "XMLHttpRequest")
      .field("foo", "bar");
    expect(res.status).toBe(400);
  });

  it("no cookie -> 401", async () => {
    const { card } = await ownerSetup();
    const res = await request(app(db, storage))
      .post(`/api/cards/${card.id}/attachments`)
      .set("x-requested-with", "XMLHttpRequest")
      .attach("file", Buffer.from("x"), { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("unverified user -> 401", async () => {
    const { card } = await ownerSetup();
    const unverified = await seedUser(db, { email: "u@example.com", verified: false });
    const res = await request(app(db, storage))
      .post(`/api/cards/${card.id}/attachments`)
      .set("Cookie", cookie(unverified))
      .set("x-requested-with", "XMLHttpRequest")
      .attach("file", Buffer.from("x"), { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("missing x-requested-with -> 403", async () => {
    const { user, card } = await ownerSetup();
    const res = await request(app(db, storage))
      .post(`/api/cards/${card.id}/attachments`)
      .set("Cookie", cookie(user))
      .attach("file", Buffer.from("x"), { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(403);
  });

  async function uploaded() {
    const { user, board, card } = await ownerSetup();
    const up = await request(app(db, storage))
      .post(`/api/cards/${card.id}/attachments`)
      .set("Cookie", cookie(user))
      .set("x-requested-with", "XMLHttpRequest")
      .attach("file", Buffer.from("payload-data"), { filename: "rép.png", contentType: "image/png" });
    return { user, board, card, id: up.body.id as string };
  }

  it("downloads bytes with correct headers", async () => {
    const { user, id } = await uploaded();
    const res = await request(app(db, storage))
      .get(`/api/attachments/${id}/download`)
      .set("Cookie", cookie(user));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["content-length"]).toBe("12");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["content-disposition"]).toMatch(/filename\*=UTF-8''/);
  });

  it("no board access -> 404 on download", async () => {
    const { id } = await uploaded();
    const stranger = await seedUser(db, { email: "s@example.com", verified: true });
    const res = await request(app(db, storage))
      .get(`/api/attachments/${id}/download`)
      .set("Cookie", cookie(stranger));
    expect(res.status).toBe(404);
  });

  it("unknown id -> 404 on download", async () => {
    const { user } = await ownerSetup();
    const res = await request(app(db, storage))
      .get(`/api/attachments/00000000-0000-0000-0000-000000000000/download`)
      .set("Cookie", cookie(user));
    expect(res.status).toBe(404);
  });

  it("storage disabled -> 503 on download", async () => {
    const { user, id } = await uploaded();
    storage.enabled = false;
    const res = await request(app(db, storage))
      .get(`/api/attachments/${id}/download`)
      .set("Cookie", cookie(user));
    expect(res.status).toBe(503);
  });

  it("unauthenticated -> 401 on download", async () => {
    const { id } = await uploaded();
    const res = await request(app(db, storage)).get(`/api/attachments/${id}/download`);
    expect(res.status).toBe(401);
  });

  it("a view-only board member can upload? no -> 404/403 via board edit", async () => {
    const { board, card } = await ownerSetup();
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
    const res = await request(app(db, storage))
      .post(`/api/cards/${card.id}/attachments`)
      .set("Cookie", cookie(viewer))
      .set("x-requested-with", "XMLHttpRequest")
      .attach("file", Buffer.from("x"), { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(404);
  });
});
