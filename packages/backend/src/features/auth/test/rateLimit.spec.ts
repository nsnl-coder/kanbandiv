import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../../../trpc/trpc.js";
import {
  createCaller,
  fakeEmail,
  makeContext,
  newTestDb,
  type FakeEmail,
  type TestDb,
} from "./helpers.js";

// register is limited to 5 requests/min per IP (see auth.router.ts).
describe("per-IP rate limiting", () => {
  let db: TestDb;
  let email: FakeEmail;

  beforeEach(async () => {
    db = await newTestDb();
    email = fakeEmail();
    resetRateLimits();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("blocks the 6th register from the same IP within the window", async () => {
    const caller = createCaller(makeContext({ db, email, ip: "1.2.3.4" }));
    for (let i = 0; i < 5; i++) {
      await caller.auth.register({ email: `u${i}@example.com`, password: "Password123" });
    }
    await expect(
      caller.auth.register({ email: "u5@example.com", password: "Password123" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("tracks limits independently per IP", async () => {
    const a = createCaller(makeContext({ db, email, ip: "10.0.0.1" }));
    const b = createCaller(makeContext({ db, email, ip: "10.0.0.2" }));
    for (let i = 0; i < 5; i++) {
      await a.auth.register({ email: `a${i}@example.com`, password: "Password123" });
    }
    // b has its own fresh budget.
    await expect(
      b.auth.register({ email: "b@example.com", password: "Password123" }),
    ).resolves.toEqual({ ok: true });
  });

  it("applies a single restrictive bucket when there is no IP (no bypass)", async () => {
    const caller = createCaller(makeContext({ db, email })); // ip defaults to null
    for (let i = 0; i < 5; i++) {
      await caller.auth.register({ email: `n${i}@example.com`, password: "Password123" });
    }
    await expect(
      caller.auth.register({ email: "n5@example.com", password: "Password123" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
