import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { AuthError } from "shared";
import {
  createCaller,
  fakeEmail,
  makeContext,
  newTestDb,
  seedUser,
  type FakeEmail,
  type TestDb,
} from "./helpers.js";

describe("auth.register", () => {
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

  it("creates an unverified user, issues no tokens", async () => {
    const res = await caller().auth.register({
      email: "new@example.com",
      password: "Password123",
    });
    expect(res).toEqual({ ok: true });

    const user = await db
      .selectFrom("users")
      .selectAll()
      .where("email", "=", "new@example.com")
      .executeTakeFirstOrThrow();
    expect(user.email_verified).toBe(false);

    const tokens = await db.selectFrom("refresh_tokens").selectAll().execute();
    expect(tokens).toHaveLength(0);
  });

  it("hashes the password with cost >= 12", async () => {
    await caller().auth.register({ email: "h@example.com", password: "Password123" });
    const user = await db
      .selectFrom("users")
      .select("password_hash")
      .where("email", "=", "h@example.com")
      .executeTakeFirstOrThrow();
    expect(user.password_hash).not.toBe("Password123");
    const cost = Number(user.password_hash.split("$")[2]);
    expect(cost).toBeGreaterThanOrEqual(12);
  });

  it("sends a verify OTP on success", async () => {
    await caller().auth.register({ email: "otp@example.com", password: "Password123" });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ type: "verify", to: "otp@example.com" });
    expect(email.lastCodeFor("otp@example.com")).toMatch(/^\d{6}$/);
  });

  it("rejects a duplicate verified email", async () => {
    await seedUser(db, { email: "dup@example.com", verified: true });
    await expect(
      caller().auth.register({ email: "dup@example.com", password: "Password123" }),
    ).rejects.toMatchObject({ message: AuthError.EMAIL_TAKEN });
  });

  it("re-issues a verify OTP when an unverified user re-registers", async () => {
    await seedUser(db, { email: "unv@example.com", verified: false });
    const res = await caller().auth.register({
      email: "unv@example.com",
      password: "Password123",
    });
    expect(res).toEqual({ ok: true });
    expect(email.lastCodeFor("unv@example.com")).toMatch(/^\d{6}$/);
  });

  it("normalizes email (trim + lowercase) and enforces case-insensitive uniqueness", async () => {
    await caller().auth.register({ email: "  Mixed@Example.com ", password: "Password123" });
    const user = await db
      .selectFrom("users")
      .select(["id", "email"])
      .executeTakeFirstOrThrow();
    expect(user.email).toBe("mixed@example.com");

    // Verify the account, then a differently-cased duplicate must be rejected.
    await db
      .updateTable("users")
      .set({ email_verified: true })
      .where("id", "=", user.id)
      .execute();
    await expect(
      caller().auth.register({ email: "MIXED@example.com", password: "Password123" }),
    ).rejects.toMatchObject({ message: AuthError.EMAIL_TAKEN });
  });

  it("rejects an invalid email format", async () => {
    await expect(
      caller().auth.register({ email: "not-an-email", password: "Password123" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects a weak password below the minimum length", async () => {
    await expect(
      caller().auth.register({ email: "weak@example.com", password: "short" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects a password longer than 72 bytes", async () => {
    await expect(
      caller().auth.register({ email: "long@example.com", password: "a".repeat(73) }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  // Password byte-length policy: emoji/multi-byte chars are allowed, the cap is on
  // UTF-8 BYTES (72, bcrypt's truncation limit), not character count.
  it("allows a password containing emoji when under 72 bytes", async () => {
    const res = await caller().auth.register({
      email: "emoji@example.com",
      password: "pass😀word", // ~13 bytes
    });
    expect(res).toEqual({ ok: true });
  });

  it("rejects an emoji password that exceeds 72 bytes", async () => {
    await expect(
      caller().auth.register({
        email: "bigemoji@example.com",
        password: "😀".repeat(19), // 19 * 4 = 76 bytes, only 19 chars
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
