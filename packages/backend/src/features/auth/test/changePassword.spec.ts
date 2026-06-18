import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { AuthError } from "shared";
import {
  createCaller,
  makeContext,
  newTestDb,
  seedRefreshToken,
  seedUser,
  type TestDb,
} from "./helpers.js";

describe("auth.changePassword", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("changes the password, persists a new hash, and accepts the new password on login", async () => {
    const user = await seedUser(db);
    const before = user.password_hash;
    const caller = createCaller(makeContext({ db, userId: user.id }));

    const res = await caller.auth.changePassword({
      currentPassword: "Password123",
      newPassword: "NewPassword123",
    });
    expect(res).toEqual({ ok: true });

    const row = await db
      .selectFrom("users")
      .select("password_hash")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();
    expect(row.password_hash).not.toBe(before);

    const loggedIn = await caller.auth.login({
      email: user.email,
      password: "NewPassword123",
    });
    expect(loggedIn.id).toBe(user.id);
  });

  it("rejects a wrong current password", async () => {
    const user = await seedUser(db);
    const caller = createCaller(makeContext({ db, userId: user.id }));

    await expect(
      caller.auth.changePassword({
        currentPassword: "WrongPassword123",
        newPassword: "NewPassword123",
      }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_CREDENTIALS });
  });

  it("revokes all of the user's refresh tokens", async () => {
    const user = await seedUser(db);
    await seedRefreshToken(db, { userId: user.id });
    const caller = createCaller(makeContext({ db, userId: user.id }));

    await caller.auth.changePassword({
      currentPassword: "Password123",
      newPassword: "NewPassword123",
    });

    const tokens = await db
      .selectFrom("refresh_tokens")
      .select("revoked_at")
      .where("user_id", "=", user.id)
      .execute();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].revoked_at).not.toBeNull();
  });

  it("requires authentication", async () => {
    await expect(
      createCaller(makeContext({ db })).auth.changePassword({
        currentPassword: "Password123",
        newPassword: "NewPassword123",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a weak new password", async () => {
    const user = await seedUser(db);
    const caller = createCaller(makeContext({ db, userId: user.id }));

    await expect(
      caller.auth.changePassword({
        currentPassword: "Password123",
        newPassword: "short",
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
