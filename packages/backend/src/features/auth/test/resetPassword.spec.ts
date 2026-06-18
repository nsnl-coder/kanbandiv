import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { AuthError, OtpPurpose } from "shared";
import { AUTH_CONSTANTS } from "../auth.service.js";
import {
  createCaller,
  makeContext,
  newTestDb,
  seedOtp,
  seedRefreshToken,
  seedUser,
  type TestDb,
} from "./helpers.js";

describe("auth.resetPassword", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const caller = () => createCaller(makeContext({ db }));

  async function setup() {
    const user = await seedUser(db);
    const code = await seedOtp(db, {
      userId: user.id,
      purpose: OtpPurpose.ResetPassword,
    });
    return { user, code };
  }

  it("succeeds and changes the password hash in DB", async () => {
    const { user, code } = await setup();
    const before = user.password_hash;

    const res = await caller().auth.resetPassword({
      email: user.email,
      otp: code,
      newPassword: "NewPassword123",
    });
    expect(res).toEqual({ ok: true });

    const after = await db
      .selectFrom("users")
      .select("password_hash")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();
    expect(after.password_hash).not.toBe(before);
  });

  it("allows login with the new password after reset", async () => {
    const { user, code } = await setup();
    await caller().auth.resetPassword({
      email: user.email,
      otp: code,
      newPassword: "NewPassword123",
    });

    const loggedIn = await caller().auth.login({
      email: user.email,
      password: "NewPassword123",
    });
    expect(loggedIn.id).toBe(user.id);
  });

  it("rejects the old password after reset", async () => {
    const { user, code } = await setup();
    await caller().auth.resetPassword({
      email: user.email,
      otp: code,
      newPassword: "NewPassword123",
    });

    await expect(
      caller().auth.login({ email: user.email, password: user.password }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_CREDENTIALS });
  });

  it("revokes all refresh tokens", async () => {
    const { user, code } = await setup();
    const raw = await seedRefreshToken(db, { userId: user.id });

    await caller().auth.resetPassword({
      email: user.email,
      otp: code,
      newPassword: "NewPassword123",
    });

    await expect(
      caller().auth.refresh({ refreshToken: raw }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_REFRESH_TOKEN });
  });

  it("consumes the OTP so a replay fails", async () => {
    const { user, code } = await setup();
    await caller().auth.resetPassword({
      email: user.email,
      otp: code,
      newPassword: "NewPassword123",
    });

    await expect(
      caller().auth.resetPassword({
        email: user.email,
        otp: code,
        newPassword: "AnotherPass123",
      }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
  });

  it("rejects a wrong OTP", async () => {
    const { user } = await setup();
    await expect(
      caller().auth.resetPassword({
        email: user.email,
        otp: "87654321",
        newPassword: "NewPassword123",
      }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
  });

  it("rejects an expired OTP", async () => {
    const user = await seedUser(db);
    const code = await seedOtp(db, {
      userId: user.id,
      purpose: OtpPurpose.ResetPassword,
      expired: true,
    });

    await expect(
      caller().auth.resetPassword({
        email: user.email,
        otp: code,
        newPassword: "NewPassword123",
      }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
  });

  it("rejects a verify-purpose OTP used for reset", async () => {
    const user = await seedUser(db);
    const code = await seedOtp(db, {
      userId: user.id,
      purpose: OtpPurpose.VerifyEmail,
      code: "12345678",
    });

    await expect(
      caller().auth.resetPassword({
        email: user.email,
        otp: code,
        newPassword: "NewPassword123",
      }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
  });

  it("locks the OTP after the attempt cap is reached", async () => {
    const user = await seedUser(db);
    const code = await seedOtp(db, {
      userId: user.id,
      purpose: OtpPurpose.ResetPassword,
      attempts: AUTH_CONSTANTS.MAX_OTP_ATTEMPTS - 1,
    });

    await expect(
      caller().auth.resetPassword({
        email: user.email,
        otp: "87654321",
        newPassword: "NewPassword123",
      }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });

    await expect(
      caller().auth.resetPassword({
        email: user.email,
        otp: code,
        newPassword: "NewPassword123",
      }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
  });

  it("rejects a weak new password", async () => {
    const { user, code } = await setup();
    await expect(
      caller().auth.resetPassword({
        email: user.email,
        otp: code,
        newPassword: "short",
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects an unknown email", async () => {
    await expect(
      caller().auth.resetPassword({
        email: "nobody@example.com",
        otp: "12345678",
        newPassword: "NewPassword123",
      }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
  });
});
