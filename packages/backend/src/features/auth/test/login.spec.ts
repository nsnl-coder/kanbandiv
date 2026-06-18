import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { AuthError, AUTH_CONSTANTS, verifyAccessToken } from "../auth.service.js";
import {
  createCaller,
  fakeEmail,
  makeContext,
  newTestDb,
  seedUser,
  type FakeEmail,
  type TestDb,
} from "./helpers.js";

describe("auth.login", () => {
  let db: TestDb;
  let email: FakeEmail;

  beforeEach(async () => {
    db = await newTestDb();
    email = fakeEmail();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const caller = () => createCaller(makeContext({ db, email }));

  it("returns access token, refresh token, and user on success", async () => {
    const seeded = await seedUser(db, { email: "ok@example.com" });
    const res = await caller().auth.login({
      email: "ok@example.com",
      password: seeded.password,
    });
    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
    expect(res.user).toMatchObject({
      id: seeded.id,
      email: "ok@example.com",
      role: "user",
      emailVerified: true,
    });
  });

  it("persists the refresh token hashed (not equal to returned token)", async () => {
    const seeded = await seedUser(db, { email: "hash@example.com" });
    const res = await caller().auth.login({
      email: "hash@example.com",
      password: seeded.password,
    });
    const row = await db
      .selectFrom("refresh_tokens")
      .select("token_hash")
      .where("user_id", "=", seeded.id)
      .executeTakeFirstOrThrow();
    expect(row.token_hash).not.toBe(res.refreshToken);
  });

  it("issues a verifiable access token carrying sub and role", async () => {
    const seeded = await seedUser(db, { email: "jwt@example.com" });
    const res = await caller().auth.login({
      email: "jwt@example.com",
      password: seeded.password,
    });
    const payload = verifyAccessToken(res.accessToken);
    expect(payload.sub).toBe(seeded.id);
    expect(payload.role).toBe("user");
  });

  it("rejects a wrong password with INVALID_CREDENTIALS", async () => {
    await seedUser(db, { email: "wrong@example.com" });
    await expect(
      caller().auth.login({ email: "wrong@example.com", password: "Nope12345" }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_CREDENTIALS });
  });

  it("rejects an unknown email with INVALID_CREDENTIALS", async () => {
    await expect(
      caller().auth.login({ email: "ghost@example.com", password: "Password123" }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_CREDENTIALS });
  });

  it("rejects an unverified user with EMAIL_NOT_VERIFIED", async () => {
    const seeded = await seedUser(db, { email: "unv@example.com", verified: false });
    await expect(
      caller().auth.login({ email: "unv@example.com", password: seeded.password }),
    ).rejects.toMatchObject({ message: AuthError.EMAIL_NOT_VERIFIED });
  });

  it("rejects an empty password with a zod TRPCError", async () => {
    await seedUser(db, { email: "empty@example.com" });
    await expect(
      caller().auth.login({ email: "empty@example.com", password: "" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("increments failed_login_count on a wrong password", async () => {
    const seeded = await seedUser(db, { email: "inc@example.com" });
    await expect(
      caller().auth.login({ email: "inc@example.com", password: "Nope12345" }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_CREDENTIALS });
    const row = await db
      .selectFrom("users")
      .select("failed_login_count")
      .where("id", "=", seeded.id)
      .executeTakeFirstOrThrow();
    expect(row.failed_login_count).toBe(1);
  });

  it("locks the account after MAX_FAILED_LOGINS failures", async () => {
    const seeded = await seedUser(db, {
      email: "lock@example.com",
      failedLoginCount: AUTH_CONSTANTS.MAX_FAILED_LOGINS - 1,
    });
    await expect(
      caller().auth.login({ email: "lock@example.com", password: "Nope12345" }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_CREDENTIALS });
    await expect(
      caller().auth.login({ email: "lock@example.com", password: seeded.password }),
    ).rejects.toMatchObject({ message: AuthError.ACCOUNT_LOCKED });
  });

  it("rejects a pre-locked account with ACCOUNT_LOCKED", async () => {
    const seeded = await seedUser(db, {
      email: "prelock@example.com",
      lockedUntil: new Date(Date.now() + AUTH_CONSTANTS.LOCK_MS),
    });
    await expect(
      caller().auth.login({ email: "prelock@example.com", password: seeded.password }),
    ).rejects.toMatchObject({ message: AuthError.ACCOUNT_LOCKED });
  });

  it("records an auth_events row on successful login", async () => {
    const seeded = await seedUser(db, { email: "audit@example.com" });
    await caller().auth.login({
      email: "audit@example.com",
      password: seeded.password,
    });
    const rows = await db
      .selectFrom("auth_events")
      .selectAll()
      .where("user_id", "=", seeded.id)
      .where("event", "=", "login")
      .execute();
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("records a failed-login auth_events row on a wrong password", async () => {
    const seeded = await seedUser(db, { email: "auditfail@example.com" });
    await expect(
      caller().auth.login({ email: "auditfail@example.com", password: "Nope12345" }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_CREDENTIALS });
    const rows = await db
      .selectFrom("auth_events")
      .selectAll()
      .where("user_id", "=", seeded.id)
      .where("event", "=", "login")
      .where("outcome", "=", "fail")
      .execute();
    expect(rows.length).toBe(1);
  });
});
