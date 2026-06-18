import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { AUTH_CONSTANTS, verifyAccessToken } from "../auth.service.js";
import { AuthError } from "shared";
import { env } from "../../../config/env.config.js";
import { createContext } from "../../../trpc/context.js";
import {
  createCaller,
  fakeEmail,
  makeContext,
  newTestDb,
  resSpy,
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

  it("returns the user and sets access + refresh cookies on success", async () => {
    const seeded = await seedUser(db, { email: "ok@example.com" });
    const res = resSpy();
    const user = await createCaller(makeContext({ db, email, res })).auth.login({
      email: "ok@example.com",
      password: seeded.password,
    });
    expect(user).toMatchObject({
      id: seeded.id,
      email: "ok@example.com",
      role: "user",
      emailVerified: true,
    });
    const names = res.cookies.map((c) => c.name);
    expect(names).toContain("access_token");
    expect(names).toContain("refresh_token");
  });

  it("persists the refresh token hashed (not equal to the cookie token)", async () => {
    const seeded = await seedUser(db, { email: "hash@example.com" });
    const res = resSpy();
    await createCaller(makeContext({ db, email, res })).auth.login({
      email: "hash@example.com",
      password: seeded.password,
    });
    const rawRefresh = res.cookies.find((c) => c.name === "refresh_token")?.value;
    const row = await db
      .selectFrom("refresh_tokens")
      .select("token_hash")
      .where("user_id", "=", seeded.id)
      .executeTakeFirstOrThrow();
    expect(row.token_hash).not.toBe(rawRefresh);
  });

  it("issues a verifiable access cookie carrying sub and role", async () => {
    const seeded = await seedUser(db, { email: "jwt@example.com" });
    const res = resSpy();
    await createCaller(makeContext({ db, email, res })).auth.login({
      email: "jwt@example.com",
      password: seeded.password,
    });
    const accessToken = res.cookies.find((c) => c.name === "access_token")?.value;
    expect(accessToken).toBeDefined();
    const payload = verifyAccessToken(accessToken!);
    expect(payload.sub).toBe(seeded.id);
    expect(payload.role).toBe("user");
  });

  it("sets hardened access + refresh cookies with their configured lifetimes", async () => {
    const seeded = await seedUser(db, { email: "cookie@example.com" });
    const res = resSpy();
    await createCaller(makeContext({ db, email, res })).auth.login({
      email: "cookie@example.com",
      password: seeded.password,
    });

    const hardened = { httpOnly: true, sameSite: "strict", path: "/", secure: env.COOKIE_SECURE };

    const access = res.cookies.find((c) => c.name === "access_token");
    expect(access?.options).toMatchObject({ ...hardened, maxAge: env.ACCESS_TTL_MS });

    const refresh = res.cookies.find((c) => c.name === "refresh_token");
    expect(refresh?.options).toMatchObject({ ...hardened, maxAge: env.REFRESH_TTL_MS });
  });

  it("issues an access cookie that authenticates a follow-up request (end-to-end)", async () => {
    const seeded = await seedUser(db, { email: "e2e@example.com" });
    const res = resSpy();
    await createCaller(makeContext({ db, email, res })).auth.login({
      email: "e2e@example.com",
      password: seeded.password,
    });
    const accessToken = res.cookies.find((c) => c.name === "access_token")?.value;
    expect(accessToken).toBeDefined();

    // Feed the issued cookie back through the real context builder, then call a
    // protected procedure. (createContext binds the prod db, so override it with
    // the test db while keeping the userId derived from the cookie.)
    const ctx = createContext({
      req: { headers: { cookie: `access_token=${accessToken}` } },
      res: {} as never,
    } as never);
    const me = await createCaller({ ...ctx, db }).auth.me({});
    expect(me.id).toBe(seeded.id);
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
