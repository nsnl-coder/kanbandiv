import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { AuthError } from "../auth.service.js";
import {
  createCaller,
  makeContext,
  newTestDb,
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

  const caller = () => createCaller(makeContext({ db }));

  it("revokes the provided token", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    const res = await caller().auth.logout({ refreshToken: raw });
    expect(res).toEqual({ ok: true });

    const row = await db
      .selectFrom("refresh_tokens")
      .select("revoked_at")
      .where("token_hash", "=", hashRefresh(raw))
      .executeTakeFirstOrThrow();
    expect(row.revoked_at).not.toBeNull();
  });

  it("makes the token unusable on refresh", async () => {
    const user = await seedUser(db);
    const raw = await seedRefreshToken(db, { userId: user.id });

    await caller().auth.logout({ refreshToken: raw });
    await expect(
      caller().auth.refresh({ refreshToken: raw }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_REFRESH_TOKEN });
  });

  it("does not revoke other sessions of the same user", async () => {
    const user = await seedUser(db);
    const rawA = await seedRefreshToken(db, { userId: user.id });
    const rawB = await seedRefreshToken(db, { userId: user.id });

    await caller().auth.logout({ refreshToken: rawA });

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
    expect(await caller().auth.logout({ refreshToken: unknown })).toEqual({ ok: true });

    expect(await caller().auth.logout({ refreshToken: raw })).toEqual({ ok: true });
    expect(await caller().auth.logout({ refreshToken: raw })).toEqual({ ok: true });
  });

  it("rejects an empty-string refreshToken", async () => {
    await expect(
      caller().auth.logout({ refreshToken: "" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("requires a token or cookie", async () => {
    await expect(caller().auth.logout({})).rejects.toMatchObject({
      message: AuthError.INVALID_REFRESH_TOKEN,
    });
  });
});
