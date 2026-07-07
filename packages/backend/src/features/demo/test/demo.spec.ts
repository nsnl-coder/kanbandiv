import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthError } from "shared";
import { login, verifyAccessToken } from "../../auth/auth.service.js";
import {
  createCaller,
  fakeEmail,
  makeContext,
  newTestDb,
  seedUser,
  type TestDb,
} from "../../auth/test/helpers.js";
import { createDemoHttpRouter } from "../demo.http.js";
import { DEMO_EMAIL_DOMAIN, sweepStaleDemoUsers } from "../demo.service.js";

function app(db: TestDb) {
  const a = express();
  a.use("/api", createDemoHttpRouter({ db: db as never }));
  return a;
}

/** set-cookie array -> { name: value } (attributes dropped). */
function cookiesOf(res: request.Response): Record<string, string> {
  const raw = (res.headers["set-cookie"] ?? []) as unknown as string[];
  return Object.fromEntries(
    raw.map((c) => {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      return [pair.slice(0, i), decodeURIComponent(pair.slice(i + 1))];
    }),
  );
}

async function visitDemo(db: TestDb) {
  const res = await request(app(db)).get("/api/auth/demo");
  expect(res.status).toBe(302);
  return res;
}

describe("GET /api/auth/demo", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("302-redirects onto the seeded board's SPA URL", async () => {
    const res = await visitDemo(db);
    const location = res.headers["location"];
    expect(location).toMatch(/^\/projects\/[0-9a-f-]{36}\/boards\/[0-9a-f-]{36}$/);

    // The redirect target is the board it just seeded.
    const [, projectId, boardId] = /^\/projects\/(.+)\/boards\/(.+)$/.exec(location)!;
    const board = await db
      .selectFrom("boards")
      .selectAll()
      .where("id", "=", boardId)
      .executeTakeFirstOrThrow();
    expect(board.project_id).toBe(projectId);
    expect(board.name).toBe("Product launch");
  });

  it("sets the same session cookies as login (httpOnly access + refresh)", async () => {
    const res = await visitDemo(db);
    const raw = (res.headers["set-cookie"] ?? []) as unknown as string[];
    const access = raw.find((c) => c.startsWith("access_token="));
    const refresh = raw.find((c) => c.startsWith("refresh_token="));
    expect(access).toContain("HttpOnly");
    expect(access).toContain("Path=/");
    expect(refresh).toContain("HttpOnly");
    expect(refresh).toContain("SameSite=Strict");

    // The access token is a real session for the created demo user.
    const sub = verifyAccessToken(cookiesOf(res)["access_token"]).sub;
    const user = await db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", sub)
      .executeTakeFirstOrThrow();
    expect(user.is_demo).toBe(true);

    // The refresh cookie drives the SPA's normal bootstrap (auth.refresh) and
    // carries the isDemo flag the banner needs.
    const caller = createCaller(
      makeContext({ db, refreshCookie: cookiesOf(res)["refresh_token"] }),
    );
    const me = await caller.auth.refresh({});
    expect(me.id).toBe(sub);
    expect(me.isDemo).toBe(true);
  });

  it("creates a flagged, verified account with no usable password", async () => {
    const res = await visitDemo(db);
    const sub = verifyAccessToken(cookiesOf(res)["access_token"]).sub;
    const user = await db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", sub)
      .executeTakeFirstOrThrow();

    expect(user.is_demo).toBe(true);
    expect(user.is_test).toBe(false); // never rate-limit-exempt / fixed-OTP
    expect(user.email_verified).toBe(true);
    expect(user.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
    expect(user.password_hash).toMatch(/^\$2/); // bcrypt of 32 random bytes

    // Password login can never succeed: the plaintext was discarded.
    await expect(
      login(
        { db, email: fakeEmail() },
        { email: user.email, password: "Password123" },
      ),
    ).rejects.toMatchObject({ message: AuthError.INVALID_CREDENTIALS });
  });

  it("seeds a worked-in board: 4 lists, 9 cards, labels, due dates, checklist", async () => {
    const res = await visitDemo(db);
    const boardId = res.headers["location"].split("/").pop()!;

    const columns = await db
      .selectFrom("columns")
      .selectAll()
      .where("board_id", "=", boardId)
      .orderBy("position", "asc")
      .execute();
    expect(columns.map((c) => c.name)).toEqual(["To do", "In progress", "Review", "Done"]);

    const cards = await db
      .selectFrom("cards")
      .innerJoin("columns", "columns.id", "cards.column_id")
      .selectAll("cards")
      .where("columns.board_id", "=", boardId)
      .execute();
    expect(cards).toHaveLength(9);
    expect(cards.every((c) => (c.description ?? "").length > 0)).toBe(true);
    expect(cards.filter((c) => c.due_at !== null).length).toBeGreaterThanOrEqual(5);

    const labels = await db
      .selectFrom("labels")
      .selectAll()
      .where("board_id", "=", boardId)
      .execute();
    expect(labels).toHaveLength(4);

    const cardLabels = await db
      .selectFrom("card_labels")
      .selectAll()
      .where("label_id", "in", labels.map((l) => l.id))
      .execute();
    expect(cardLabels.length).toBeGreaterThanOrEqual(9);

    const checklistItems = await db
      .selectFrom("checklist_items")
      .innerJoin("checklists", "checklists.id", "checklist_items.checklist_id")
      .selectAll("checklist_items")
      .where("checklists.card_id", "in", cards.map((c) => c.id))
      .execute();
    expect(checklistItems.length).toBeGreaterThanOrEqual(4);
    expect(checklistItems.some((i) => i.is_done)).toBe(true);
  });

  it("creates a fresh account per visit", async () => {
    const a = await visitDemo(db);
    const b = await visitDemo(db);
    expect(verifyAccessToken(cookiesOf(a)["access_token"]).sub).not.toBe(
      verifyAccessToken(cookiesOf(b)["access_token"]).sub,
    );
  });

  it("is rate limited per IP", async () => {
    const a = app(db); // one router instance = one limiter bucket
    const results: number[] = [];
    for (let i = 0; i < 4; i++) {
      results.push((await request(a).get("/api/auth/demo")).status);
    }
    expect(results.slice(0, 3)).toEqual([302, 302, 302]);
    expect(results[3]).toBe(429);
  });
});

describe("sweepStaleDemoUsers", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("deletes only demo users past retention, cascading their content", async () => {
    const stale = await visitDemo(db);
    const staleId = verifyAccessToken(cookiesOf(stale)["access_token"]).sub;
    const staleBoardId = stale.headers["location"].split("/").pop()!;
    await db
      .updateTable("users")
      .set({ created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where("id", "=", staleId)
      .execute();

    const fresh = await visitDemo(db);
    const freshId = verifyAccessToken(cookiesOf(fresh)["access_token"]).sub;

    // An old REAL account must never be swept.
    const veteran = await seedUser(db, { email: "veteran@example.com" });
    await db
      .updateTable("users")
      .set({ created_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) })
      .where("id", "=", veteran.id)
      .execute();

    const deleted = await sweepStaleDemoUsers(db);
    expect(deleted).toBe(1);

    const remaining = await db.selectFrom("users").select("id").execute();
    const ids = remaining.map((r) => r.id);
    expect(ids).not.toContain(staleId);
    expect(ids).toContain(freshId);
    expect(ids).toContain(veteran.id);

    // FK cascades removed the stale user's content with it.
    const board = await db
      .selectFrom("boards")
      .select("id")
      .where("id", "=", staleBoardId)
      .executeTakeFirst();
    expect(board).toBeUndefined();
    const orphanProjects = await db
      .selectFrom("projects")
      .select("id")
      .where("owner_id", "=", staleId)
      .execute();
    expect(orphanProjects).toHaveLength(0);
  });
});
