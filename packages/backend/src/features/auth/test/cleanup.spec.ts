import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OtpPurpose } from "shared";
import { cleanupExpired } from "../auth.service.js";
import { newTestDb, seedOtp, seedRefreshToken, seedUser, type TestDb } from "./helpers.js";

describe("cleanupExpired", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("removes expired and consumed OTPs but keeps active ones", async () => {
    const user = await seedUser(db);
    await seedOtp(db, { userId: user.id, expired: true });
    await seedOtp(db, { userId: user.id, consumed: true });
    await seedOtp(db, { userId: user.id, purpose: OtpPurpose.VerifyEmail }); // active

    const result = await cleanupExpired(db);
    expect(result.otps).toBe(2);

    const remaining = await db.selectFrom("otp_codes").selectAll().execute();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].consumed_at).toBeNull();
  });

  it("removes revoked and expired refresh tokens but keeps active ones", async () => {
    const user = await seedUser(db);
    await seedRefreshToken(db, { userId: user.id, revoked: true });
    await seedRefreshToken(db, { userId: user.id, expired: true });
    await seedRefreshToken(db, { userId: user.id }); // active

    const result = await cleanupExpired(db);
    expect(result.tokens).toBe(2);

    const remaining = await db.selectFrom("refresh_tokens").selectAll().execute();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].revoked_at).toBeNull();
  });
});
