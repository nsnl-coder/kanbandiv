import express from "express";
import request from "supertest";
import { BoardEventType, ProjectPermission, UserEventKind } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "../../auth/auth.service.js";
import { createBus } from "../realtime.bus.js";
import { createRealtimeHttpRouter } from "../realtime.http.js";
import {
  newTestDb,
  seedBoard,
  seedBoardAccess,
  seedProject,
  seedUser,
  type TestDb,
} from "./helpers.js";

function tokenFor(user: { id: string; email: string }) {
  return signAccessToken({ id: user.id, email: user.email } as never);
}
const cookie = (user: { id: string; email: string }) => `access_token=${tokenFor(user)}`;

function app(db: TestDb, bus = createBus({ redisUrl: "" })) {
  const a = express();
  a.use("/api", createRealtimeHttpRouter({ db: db as never, bus }));
  return { a, bus };
}

async function ownerBoard(db: TestDb) {
  const user = await seedUser(db, { email: "owner@example.com", verified: true });
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, { projectId: project.id, ownerId: user.id });
  return { user, board };
}

// Open the SSE stream, read the first bytes, then abort (the route never ends).
function openStream(a: express.Express, url: string, cookieVal?: string) {
  const req = request(a).get(url);
  if (cookieVal) req.set("Cookie", cookieVal);
  return req;
}

describe("realtime SSE http route", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("no cookie -> 401", async () => {
    const { board } = await ownerBoard(db);
    const { a } = app(db);
    const res = await request(a).get(`/api/boards/${board.id}/events`);
    expect(res.status).toBe(401);
  });

  it("bad token -> 401", async () => {
    const { board } = await ownerBoard(db);
    const { a } = app(db);
    const res = await request(a)
      .get(`/api/boards/${board.id}/events`)
      .set("Cookie", "access_token=garbage");
    expect(res.status).toBe(401);
  });

  it("unverified user -> 401", async () => {
    const { board } = await ownerBoard(db);
    const unverified = await seedUser(db, { email: "u@example.com", verified: false });
    const { a } = app(db);
    const res = await request(a)
      .get(`/api/boards/${board.id}/events`)
      .set("Cookie", cookie(unverified));
    expect(res.status).toBe(401);
  });

  it("no board access -> 404 (no existence leak)", async () => {
    const { board } = await ownerBoard(db);
    const stranger = await seedUser(db, { email: "s@example.com", verified: true });
    const { a } = app(db);
    const res = await request(a)
      .get(`/api/boards/${board.id}/events`)
      .set("Cookie", cookie(stranger));
    expect(res.status).toBe(404);
  });

  it("view-only member -> 200, stream opens with SSE headers + connected comment", async () => {
    const { board } = await ownerBoard(db);
    const viewer = await seedUser(db, { email: "v@example.com", verified: true });
    await seedBoardAccess(db, board.id, viewer.id, ProjectPermission.View);
    const { a, bus } = app(db);

    await new Promise<void>((resolve, reject) => {
      const req = openStream(a, `/api/boards/${board.id}/events`, cookie(viewer));
      req
        .buffer(false)
        .parse((res, _cb) => {
          res.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            expect(res.headers["content-type"]).toContain("text/event-stream");
            expect(res.headers["x-accel-buffering"]).toBe("no");
            expect(res.statusCode).toBe(200);
            expect(text).toContain(": connected");
            (res as { destroy?: () => void }).destroy?.();
            resolve();
          });
        })
        .end((err) => {
          // aborting the request surfaces as an error; ignore it.
          if (err && !/aborted|socket hang up|ECONNRESET/i.test(String(err))) reject(err);
        });
      void bus;
    });
  });

  it("delivers a published board event to the open stream", async () => {
    const { board, user } = await ownerBoard(db);
    const { a, bus } = app(db);

    await new Promise<void>((resolve, reject) => {
      const req = openStream(a, `/api/boards/${board.id}/events`, cookie(user));
      req
        .buffer(false)
        .parse((res, _cb) => {
          res.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            if (text.includes(": connected")) {
              // stream is live; publish now
              bus.publish({
                boardId: board.id,
                actorId: user.id,
                ts: Date.now(),
                type: BoardEventType.BOARD_CHANGED,
              });
              return;
            }
            if (text.startsWith("data:")) {
              const payload = JSON.parse(text.replace(/^data:\s*/, "").trim());
              expect(payload.boardId).toBe(board.id);
              expect(payload.type).toBe(BoardEventType.BOARD_CHANGED);
              (res as { destroy?: () => void }).destroy?.();
              resolve();
            }
          });
        })
        .end((err) => {
          if (err && !/aborted|socket hang up|ECONNRESET/i.test(String(err))) reject(err);
        });
    });
  });

  it("a non-member never receives the board's events (scoped subscribe)", async () => {
    // Authorization is on connect: a stranger gets 404 and never subscribes.
    const { board } = await ownerBoard(db);
    const stranger = await seedUser(db, { email: "x@example.com", verified: true });
    const { a } = app(db);
    const res = await request(a)
      .get(`/api/boards/${board.id}/events`)
      .set("Cookie", cookie(stranger));
    expect(res.status).toBe(404);
  });

  it("per-user events: no cookie -> 401", async () => {
    const { a } = app(db);
    const res = await request(a).get("/api/me/notifications/events");
    expect(res.status).toBe(401);
  });

  it("per-user events: delivers the caller's nudge, not another user's", async () => {
    const me = await seedUser(db, { email: "me@example.com", verified: true });
    const other = await seedUser(db, { email: "other@example.com", verified: true });
    const { a, bus } = app(db);

    await new Promise<void>((resolve, reject) => {
      const req = openStream(a, "/api/me/notifications/events", cookie(me));
      req
        .buffer(false)
        .parse((res, _cb) => {
          res.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            if (text.includes(": connected")) {
              expect(res.headers["content-type"]).toContain("text/event-stream");
              // a nudge for another user must NOT arrive; mine must.
              bus.publishUser({ userId: other.id, kind: UserEventKind.NOTIFICATION, ts: Date.now() });
              bus.publishUser({ userId: me.id, kind: UserEventKind.NOTIFICATION, ts: Date.now() });
              return;
            }
            if (text.startsWith("data:")) {
              const payload = JSON.parse(text.replace(/^data:\s*/, "").trim());
              expect(payload.userId).toBe(me.id);
              expect(payload.kind).toBe(UserEventKind.NOTIFICATION);
              (res as { destroy?: () => void }).destroy?.();
              resolve();
            }
          });
        })
        .end((err) => {
          if (err && !/aborted|socket hang up|ECONNRESET/i.test(String(err))) reject(err);
        });
    });
  });
});
