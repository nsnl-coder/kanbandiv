import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { AuthError } from "shared";
import { loginWithGoogle, verifyAccessToken } from "../auth.service.js";
import {
  fakeEmail,
  newTestDb,
  seedUser,
  type FakeEmail,
  type TestDb,
} from "./helpers.js";

describe("auth.loginWithGoogle", () => {
  let db: TestDb;
  let email: FakeEmail;

  beforeEach(async () => {
    db = await newTestDb();
    email = fakeEmail();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const deps = () => ({ db, email, ip: null, userAgent: null });
  const profile = (over: Partial<{ sub: string; email: string; emailVerified: boolean }> = {}) => ({
    sub: "google-sub-1",
    email: "g@example.com",
    emailVerified: true,
    ...over,
  });

  it("creates a new verified account on first Google sign-in", async () => {
    const tokens = await loginWithGoogle(deps(), profile());
    expect(tokens.user.email).toBe("g@example.com");
    expect(tokens.user.emailVerified).toBe(true);
    expect(tokens.user.oauthProvider).toBe("google");
    expect(verifyAccessToken(tokens.accessToken).sub).toBe(tokens.user.id);

    const row = await db
      .selectFrom("users")
      .selectAll()
      .where("email", "=", "g@example.com")
      .executeTakeFirstOrThrow();
    expect(row.oauth_sub).toBe("google-sub-1");
    expect(row.password_hash.length).toBeGreaterThan(0);
  });

  it("returns the same account on repeat sign-in (matched by sub)", async () => {
    const first = await loginWithGoogle(deps(), profile());
    const second = await loginWithGoogle(deps(), profile({ email: "changed@example.com" }));
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.email).toBe("g@example.com");
  });

  it("links to an existing verified password account by email", async () => {
    const seeded = await seedUser(db, { email: "g@example.com", verified: true });
    const tokens = await loginWithGoogle(deps(), profile());
    expect(tokens.user.id).toBe(seeded.id);
    const row = await db
      .selectFrom("users")
      .select(["oauth_provider", "oauth_sub"])
      .where("id", "=", seeded.id)
      .executeTakeFirstOrThrow();
    expect(row.oauth_provider).toBe("google");
    expect(row.oauth_sub).toBe("google-sub-1");
  });

  it("rejects linking to an unverified password account", async () => {
    await seedUser(db, { email: "g@example.com", verified: false });
    await expect(loginWithGoogle(deps(), profile())).rejects.toMatchObject({
      message: AuthError.EMAIL_NOT_VERIFIED,
    });
  });

  it("rejects an unverified Google email", async () => {
    await expect(
      loginWithGoogle(deps(), profile({ emailVerified: false })),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
