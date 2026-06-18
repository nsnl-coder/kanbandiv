import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { AuthError, OtpPurpose } from "shared";
import { AUTH_CONSTANTS } from "../auth.service.js";
import {
  createCaller,
  fakeEmail,
  makeContext,
  newTestDb,
  seedOtp,
  seedUser,
  type FakeEmail,
  type TestDb,
} from "./helpers.js";

describe("auth.verifyEmail", () => {
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

  async function verified(userId: string): Promise<boolean> {
    const row = await db
      .selectFrom("users")
      .select("email_verified")
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    return row.email_verified;
  }

  it("verifies a valid OTP and sets email_verified=true", async () => {
    const user = await seedUser(db, { verified: false });
    const code = await seedOtp(db, { userId: user.id, purpose: OtpPurpose.VerifyEmail });

    const res = await caller().auth.verifyEmail({ email: user.email, otp: code });
    expect(res).toEqual({ ok: true });
    expect(await verified(user.id)).toBe(true);
  });

  it("consumes the OTP so a replay is rejected", async () => {
    const user = await seedUser(db, { verified: false });
    const code = await seedOtp(db, { userId: user.id, purpose: OtpPurpose.VerifyEmail });

    await caller().auth.verifyEmail({ email: user.email, otp: code });
    await db
      .updateTable("users")
      .set({ email_verified: false })
      .where("id", "=", user.id)
      .execute();

    await expect(
      caller().auth.verifyEmail({ email: user.email, otp: code }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
  });

  it("rejects a wrong OTP code", async () => {
    const user = await seedUser(db, { verified: false });
    await seedOtp(db, { userId: user.id, purpose: OtpPurpose.VerifyEmail });

    await expect(
      caller().auth.verifyEmail({ email: user.email, otp: "654321" }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
  });

  it("rejects an expired OTP", async () => {
    const user = await seedUser(db, { verified: false });
    const code = await seedOtp(db, {
      userId: user.id,
      purpose: OtpPurpose.VerifyEmail,
      expired: true,
    });

    await expect(
      caller().auth.verifyEmail({ email: user.email, otp: code }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
  });

  it("rejects an OTP for an unknown email", async () => {
    await expect(
      caller().auth.verifyEmail({ email: "ghost@example.com", otp: "123456" }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
  });

  it("rejects a reset-purpose OTP used for verify", async () => {
    const user = await seedUser(db, { verified: false });
    const code = await seedOtp(db, {
      userId: user.id,
      purpose: OtpPurpose.ResetPassword,
      code: "123456",
    });

    await expect(
      caller().auth.verifyEmail({ email: user.email, otp: code }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
  });

  it("rejects when the user is already verified", async () => {
    const user = await seedUser(db, { verified: true });
    const code = await seedOtp(db, { userId: user.id, purpose: OtpPurpose.VerifyEmail });

    await expect(
      caller().auth.verifyEmail({ email: user.email, otp: code }),
    ).rejects.toMatchObject({ message: AuthError.ALREADY_VERIFIED });
  });

  it("increments attempts and locks the OTP at the max-attempts boundary", async () => {
    const user = await seedUser(db, { verified: false });
    const code = await seedOtp(db, {
      userId: user.id,
      purpose: OtpPurpose.VerifyEmail,
      attempts: AUTH_CONSTANTS.MAX_OTP_ATTEMPTS - 1,
    });

    await expect(
      caller().auth.verifyEmail({ email: user.email, otp: "000000" }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });

    await expect(
      caller().auth.verifyEmail({ email: user.email, otp: code }),
    ).rejects.toMatchObject({ message: AuthError.INVALID_OTP });
    expect(await verified(user.id)).toBe(false);
  });

  it("rejects an invalid OTP format via zod", async () => {
    const user = await seedUser(db, { verified: false });
    await seedOtp(db, { userId: user.id, purpose: OtpPurpose.VerifyEmail });

    await expect(
      caller().auth.verifyEmail({ email: user.email, otp: "abc" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
