import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthError } from "shared";
import { env } from "../../../config/env.config.js";
import {
  createCaller,
  makeContext,
  newTestDb,
  resSpy,
  seedRefreshToken,
  seedUser,
  type TestDb,
} from "./helpers.js";

describe("auth.refresh", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const hashOf = (raw: string) =>
    crypto.createHash("sha256").update(raw).digest("hex");

  // Refresh reads the rotating token from the httpOnly cookie only.
  const refresh = (refreshCookie: string | null, res?: ReturnType<typeof resSpy>) =>
    createCaller(makeContext({ db, refreshCookie, res })).auth.refresh({});

  it("returns the user and sets a new access + refresh cookie, persisting the new refresh hashed", async () => {
    const seeded = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: seeded.id });
    const res = resSpy();

    const user = await refresh(raw, res);

    expect(user.id).toBe(seeded.id);
    const names = res.cookies.map((c) => c.name);
    expect(names).toContain("access_token");
    const newRefresh = res.cookies.find((c) => c.name === "refresh_token")?.value as string;
    expect(newRefresh).toEqual(expect.any(String));
    expect(newRefresh).not.toBe(raw);

    const stored = await db
      .selectFrom("refresh_tokens")
      .selectAll()
      .where("token_hash", "=", hashOf(newRefresh))
      .executeTakeFirstOrThrow();
    expect(stored.revoked_at).toBeNull();
  });

  it("revokes the old refresh row after rotation", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    await refresh(raw);

    const old = await db
      .selectFrom("refresh_tokens")
      .selectAll()
      .where("token_hash", "=", hashOf(raw))
      .executeTakeFirstOrThrow();
    expect(old.revoked_at).not.toBeNull();
  });

  it("rejects reuse of the same original token", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    await refresh(raw);
    await expect(refresh(raw)).rejects.toMatchObject({
      message: AuthError.INVALID_REFRESH_TOKEN,
    });
  });

  it("revokes the entire family on reuse", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    const res = resSpy();
    await refresh(raw, res);
    const newRefresh = res.cookies.find((c) => c.name === "refresh_token")?.value as string;
    const familyId = await db
      .selectFrom("refresh_tokens")
      .select("family_id")
      .where("token_hash", "=", hashOf(raw))
      .executeTakeFirstOrThrow();

    await expect(refresh(raw)).rejects.toMatchObject({
      message: AuthError.INVALID_REFRESH_TOKEN,
    });

    const rows = await db
      .selectFrom("refresh_tokens")
      .selectAll()
      .where("family_id", "=", familyId.family_id)
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.revoked_at).not.toBeNull();
    // sanity: the rotated child belongs to the same family
    expect(rows.some((r) => r.token_hash === hashOf(newRefresh))).toBe(true);
  });

  it("rejects an expired token", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id, expired: true });

    await expect(refresh(raw)).rejects.toMatchObject({
      message: AuthError.INVALID_REFRESH_TOKEN,
    });
  });

  it("rejects an unknown/garbage token", async () => {
    await expect(refresh("garbage-not-a-real-token")).rejects.toMatchObject({
      message: AuthError.INVALID_REFRESH_TOKEN,
    });
  });

  it("rejects a manually-revoked token", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id, revoked: true });

    await expect(refresh(raw)).rejects.toMatchObject({
      message: AuthError.INVALID_REFRESH_TOKEN,
    });
  });

  it("rejects when no refresh cookie is present", async () => {
    await expect(refresh(null)).rejects.toMatchObject({
      message: AuthError.INVALID_REFRESH_TOKEN,
    });
  });

  it("sets hardened access + refresh cookies with their configured lifetimes", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });
    const res = resSpy();

    await refresh(raw, res);

    expect(res.cookies).toHaveLength(2);
    const hardened = { httpOnly: true, sameSite: "strict", path: "/", secure: env.COOKIE_SECURE };

    const access = res.cookies.find((x) => x.name === "access_token");
    expect(access, "access_token cookie").toBeDefined();
    expect(access?.options).toMatchObject({ ...hardened, maxAge: env.ACCESS_TTL_MS });

    const refreshCookie = res.cookies.find((x) => x.name === "refresh_token");
    expect(refreshCookie, "refresh_token cookie").toBeDefined();
    expect(refreshCookie?.options).toMatchObject({ ...hardened, maxAge: env.REFRESH_TTL_MS });
  });

  it("rejects a valid token whose user was deleted", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });
    await db.deleteFrom("users").where("id", "=", user.id).execute();

    await expect(refresh(raw)).rejects.toMatchObject({
      message: AuthError.INVALID_REFRESH_TOKEN,
    });
  });
});
