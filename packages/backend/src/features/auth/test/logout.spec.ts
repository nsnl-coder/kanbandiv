import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { AuthError } from "shared";
import {
  createCaller,
  makeContext,
  newTestDb,
  resSpy,
  seedRefreshToken,
  seedUser,
  type TestDb,
} from "./helpers.js";

function hashRefresh(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

describe("auth.logout", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  // Logout reads the refresh token from the httpOnly cookie only.
  const logout = (refreshCookie: string | null, res?: ReturnType<typeof resSpy>) =>
    createCaller(makeContext({ db, refreshCookie, res })).auth.logout({});

  it("revokes the token from the cookie", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    const res = await logout(raw);
    expect(res).toEqual({ ok: true });

    const row = await db
      .selectFrom("refresh_tokens")
      .select("revoked_at")
      .where("token_hash", "=", hashRefresh(raw))
      .executeTakeFirstOrThrow();
    expect(row.revoked_at).not.toBeNull();
  });

  it("clears both the access and refresh cookies", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });
    const res = resSpy();

    await logout(raw, res);

    const clearedNames = res.cleared.map((c) => c.name);
    expect(clearedNames).toContain("access_token");
    expect(clearedNames).toContain("refresh_token");
    for (const c of res.cleared) {
      expect(c.options).toMatchObject({ path: "/" });
    }
  });

  it("makes the token unusable on refresh", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    await logout(raw);
    await expect(
      createCaller(makeContext({ db, refreshCookie: raw })).auth.refresh({}),
    ).rejects.toMatchObject({ message: AuthError.INVALID_REFRESH_TOKEN });
  });

  it("does not revoke other sessions of the same user", async () => {
    const user = await seedUser(db);
    const rawA = await seedRefreshToken(db, { userId: user.id });
    const rawB = await seedRefreshToken(db, { userId: user.id });

    await logout(rawA);

    const rowB = await db
      .selectFrom("refresh_tokens")
      .select("revoked_at")
      .where("token_hash", "=", hashRefresh(rawB))
      .executeTakeFirstOrThrow();
    expect(rowB.revoked_at).toBeNull();
  });

  it("is idempotent for unknown and repeated tokens", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    const unknown = crypto.randomBytes(32).toString("base64url");
    expect(await logout(unknown)).toEqual({ ok: true });

    expect(await logout(raw)).toEqual({ ok: true });
    expect(await logout(raw)).toEqual({ ok: true });
  });

  it("requires a refresh cookie", async () => {
    await expect(logout(null)).rejects.toMatchObject({
      message: AuthError.INVALID_REFRESH_TOKEN,
    });
  });
});
