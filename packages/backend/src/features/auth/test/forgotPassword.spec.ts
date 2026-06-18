import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthError, OtpPurpose } from "shared";
import { AUTH_CONSTANTS } from "../auth.service.js";
import {
  createCaller,
  fakeEmail,
  makeContext,
  newTestDb,
  seedUser,
  type FakeEmail,
  type TestDb,
} from "./helpers.js";

describe("auth.forgotPassword", () => {
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

  const resetOtps = (userId: string) =>
    db
      .selectFrom("otp_codes")
      .selectAll()
      .where("user_id", "=", userId)
      .where("purpose", "=", OtpPurpose.ResetPassword)
      .execute();

  it("issues a reset OTP and emails it for an existing user", async () => {
    const user = await seedUser(db, { email: "existing@example.com" });
    const res = await caller().auth.forgotPassword({ email: "existing@example.com" });
    expect(res).toEqual({ ok: true });

    const otps = await resetOtps(user.id);
    expect(otps).toHaveLength(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ type: "reset", to: "existing@example.com" });
    expect(email.lastCodeFor("existing@example.com")).toMatch(/^\d{8}$/);
  });

  it("is silent for a non-existing email (no otp, no email)", async () => {
    const res = await caller().auth.forgotPassword({ email: "ghost@example.com" });
    expect(res).toEqual({ ok: true });

    const otps = await db.selectFrom("otp_codes").selectAll().execute();
    expect(otps).toHaveLength(0);
    expect(email.sent).toHaveLength(0);
  });

  it("returns an identical response shape for existing vs non-existing", async () => {
    await seedUser(db, { email: "real@example.com" });
    const hit = await caller().auth.forgotPassword({ email: "real@example.com" });
    const miss = await caller().auth.forgotPassword({ email: "nobody@example.com" });
    expect(hit).toEqual(miss);
    expect(hit).toEqual({ ok: true });
  });

  it("invalidates a previous unconsumed reset OTP", async () => {
    const user = await seedUser(db, { email: "twice@example.com" });
    await caller().auth.forgotPassword({ email: "twice@example.com" });
    await caller().auth.forgotPassword({ email: "twice@example.com" });

    const active = (await resetOtps(user.id)).filter((o) => o.consumed_at === null);
    expect(active).toHaveLength(1);
  });

  it("rate-limits the 4th call within the window", async () => {
    await seedUser(db, { email: "rl@example.com" });
    for (let i = 0; i < AUTH_CONSTANTS.RESEND_CAP; i++) {
      await caller().auth.forgotPassword({ email: "rl@example.com" });
    }
    await expect(
      caller().auth.forgotPassword({ email: "rl@example.com" }),
    ).rejects.toMatchObject({ message: AuthError.RATE_LIMITED });
  });

  it("does not change the user's password_hash", async () => {
    const user = await seedUser(db, { email: "keep@example.com" });
    await caller().auth.forgotPassword({ email: "keep@example.com" });
    const after = await db
      .selectFrom("users")
      .select("password_hash")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();
    expect(after.password_hash).toBe(user.password_hash);
  });
});
