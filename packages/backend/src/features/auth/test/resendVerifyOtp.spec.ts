import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("auth.resendVerifyOtp", () => {
  let db: TestDb;
  let email: FakeEmail;

  beforeEach(async () => {
    db = await newTestDb();
    email = fakeEmail();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.destroy();
  });

  const caller = () => createCaller(makeContext({ db, email }));

  const activeVerifyOtps = (userId: string) =>
    db
      .selectFrom("otp_codes")
      .selectAll()
      .where("user_id", "=", userId)
      .where("purpose", "=", OtpPurpose.VerifyEmail)
      .where("consumed_at", "is", null)
      .execute();

  it("issues a new verify OTP on success", async () => {
    const user = await seedUser(db, { email: "u@example.com", verified: false });
    const res = await caller().auth.resendVerifyOtp({ email: user.email });
    expect(res).toEqual({ ok: true });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ type: "verify", to: user.email });
    expect(email.lastCodeFor(user.email)).toMatch(/^\d{6}$/);
  });

  it("invalidates the previous unconsumed verify OTP", async () => {
    const user = await seedUser(db, { email: "u@example.com", verified: false });
    await seedOtp(db, { userId: user.id, purpose: OtpPurpose.VerifyEmail });

    await caller().auth.resendVerifyOtp({ email: user.email });

    const active = await activeVerifyOtps(user.id);
    expect(active).toHaveLength(1);
  });

  it("resets the attempts counter on re-issue", async () => {
    const user = await seedUser(db, { email: "u@example.com", verified: false });
    await seedOtp(db, { userId: user.id, purpose: OtpPurpose.VerifyEmail, attempts: 4 });

    await caller().auth.resendVerifyOtp({ email: user.email });

    const active = await activeVerifyOtps(user.id);
    expect(active).toHaveLength(1);
    expect(active[0].attempts).toBe(0);
  });

  it("rate-limits the 4th resend within the window", async () => {
    const user = await seedUser(db, { email: "u@example.com", verified: false });
    for (let i = 0; i < AUTH_CONSTANTS.RESEND_CAP; i++) {
      await caller().auth.resendVerifyOtp({ email: user.email });
    }
    await expect(
      caller().auth.resendVerifyOtp({ email: user.email }),
    ).rejects.toMatchObject({ message: AuthError.RATE_LIMITED });
  });

  it("allows resending again after the window passes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-06-18T00:00:00.000Z");
    vi.setSystemTime(start);

    const user = await seedUser(db, { email: "u@example.com", verified: false });
    for (let i = 0; i < AUTH_CONSTANTS.RESEND_CAP; i++) {
      await caller().auth.resendVerifyOtp({ email: user.email });
    }
    await expect(
      caller().auth.resendVerifyOtp({ email: user.email }),
    ).rejects.toMatchObject({ message: AuthError.RATE_LIMITED });

    vi.setSystemTime(new Date(start.getTime() + AUTH_CONSTANTS.RESEND_WINDOW_MS + 1000));

    const res = await caller().auth.resendVerifyOtp({ email: user.email });
    expect(res).toEqual({ ok: true });
  });

  it("is a silent no-op for an unknown email", async () => {
    const res = await caller().auth.resendVerifyOtp({ email: "nobody@example.com" });
    expect(res).toEqual({ ok: true });
    expect(email.sent).toHaveLength(0);
  });

  it("is a no-op when the user is already verified", async () => {
    const user = await seedUser(db, { email: "v@example.com", verified: true });
    const res = await caller().auth.resendVerifyOtp({ email: user.email });
    expect(res).toEqual({ ok: true });
    expect(email.sent).toHaveLength(0);
  });
});
