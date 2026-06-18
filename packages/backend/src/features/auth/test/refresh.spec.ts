import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthError } from "../auth.service.js";
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

  const caller = () => createCaller(makeContext({ db }));

  const hashOf = (raw: string) =>
    crypto.createHash("sha256").update(raw).digest("hex");

  it("returns a new access and refresh token, persisting the new refresh hashed", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    const res = await caller().auth.refresh({ refreshToken: raw });

    expect(res.accessToken).toEqual(expect.any(String));
    expect(res.refreshToken).toEqual(expect.any(String));
    expect(res.refreshToken).not.toBe(raw);
    expect(res.user.id).toBe(user.id);

    const stored = await db
      .selectFrom("refresh_tokens")
      .selectAll()
      .where("token_hash", "=", hashOf(res.refreshToken))
      .executeTakeFirstOrThrow();
    expect(stored.revoked_at).toBeNull();
  });

  it("revokes the old refresh row after rotation", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    await caller().auth.refresh({ refreshToken: raw });

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

    await caller().auth.refresh({ refreshToken: raw });
    await expect(
      caller().auth.refresh({ refreshToken: raw }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_REFRESH_TOKEN });
  });

  it("revokes the entire family on reuse", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    const res = await caller().auth.refresh({ refreshToken: raw });
    const familyId = await db
      .selectFrom("refresh_tokens")
      .select("family_id")
      .where("token_hash", "=", hashOf(raw))
      .executeTakeFirstOrThrow();

    await expect(
      caller().auth.refresh({ refreshToken: raw }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_REFRESH_TOKEN });

    const rows = await db
      .selectFrom("refresh_tokens")
      .selectAll()
      .where("family_id", "=", familyId.family_id)
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.revoked_at).not.toBeNull();
    // sanity: the rotated child belongs to the same family
    expect(rows.some((r) => r.token_hash === hashOf(res.refreshToken))).toBe(true);
  });

  it("rejects an expired token", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id, expired: true });

    await expect(
      caller().auth.refresh({ refreshToken: raw }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_REFRESH_TOKEN });
  });

  it("rejects an unknown/garbage token", async () => {
    await expect(
      caller().auth.refresh({ refreshToken: "garbage-not-a-real-token" }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_REFRESH_TOKEN });
  });

  it("rejects a manually-revoked token", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id, revoked: true });

    await expect(
      caller().auth.refresh({ refreshToken: raw }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_REFRESH_TOKEN });
  });

  it("rotates using the refresh cookie when no body token is given", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    const res = await createCaller(
      makeContext({ db, refreshCookie: raw }),
    ).auth.refresh({});

    expect(res.refreshToken).not.toBe(raw);
    expect(res.user.id).toBe(user.id);
    const old = await db
      .selectFrom("refresh_tokens")
      .selectAll()
      .where("token_hash", "=", hashOf(raw))
      .executeTakeFirstOrThrow();
    expect(old.revoked_at).not.toBeNull();
  });

  it("rejects when no token is provided in body or cookie", async () => {
    await expect(caller().auth.refresh({})).rejects.toMatchObject({
      message: AuthError.INVALID_REFRESH_TOKEN,
    });
  });

  it("sets a hardened httpOnly refresh cookie on success", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });
    const res = resSpy();

    await createCaller(makeContext({ db, res })).auth.refresh({ refreshToken: raw });

    expect(res.cookies).toHaveLength(1);
    const c = res.cookies[0];
    expect(c.name).toBe("refresh_token");
    expect(c.options).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
  });

  it("rejects a valid token whose user was deleted", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });
    await db.deleteFrom("users").where("id", "=", user.id).execute();

    await expect(
      caller().auth.refresh({ refreshToken: raw }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_REFRESH_TOKEN });
  });
});
