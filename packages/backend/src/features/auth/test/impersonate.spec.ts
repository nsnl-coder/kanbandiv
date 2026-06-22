import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCaller, makeContext, newTestDb, seedUser, type TestDb } from "./helpers.js";

describe("auth.impersonate / stopImpersonation", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("lets a superuser impersonate another user", async () => {
    const su = await seedUser(db, { email: "root@example.com", isSuperuser: true, verified: true });
    const target = await seedUser(db, { email: "target@example.com", verified: true });
    const caller = createCaller(makeContext({ db, userId: su.id }));

    const res = await caller.auth.impersonate({ userId: target.id });
    expect(res.id).toBe(target.id);
    expect(res.email).toBe("target@example.com");
    expect(res.impersonator).toMatchObject({ id: su.id, email: "root@example.com" });
  });

  it("rejects impersonation by a non-superuser", async () => {
    const user = await seedUser(db, { email: "plain@example.com", verified: true });
    const target = await seedUser(db, { email: "target@example.com", verified: true });
    const caller = createCaller(makeContext({ db, userId: user.id }));

    await expect(caller.auth.impersonate({ userId: target.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects impersonating an unverified user", async () => {
    const su = await seedUser(db, { email: "root@example.com", isSuperuser: true, verified: true });
    const target = await seedUser(db, { email: "unverified@example.com", verified: false });
    const caller = createCaller(makeContext({ db, userId: su.id }));

    await expect(caller.auth.impersonate({ userId: target.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects impersonating yourself", async () => {
    const su = await seedUser(db, { email: "root@example.com", isSuperuser: true, verified: true });
    const caller = createCaller(makeContext({ db, userId: su.id }));

    await expect(caller.auth.impersonate({ userId: su.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("returns to the admin account on stopImpersonation", async () => {
    const su = await seedUser(db, { email: "root@example.com", isSuperuser: true, verified: true });
    const target = await seedUser(db, { email: "target@example.com", verified: true });
    // Acting as the target, with the imp cookie identifying the admin.
    const caller = createCaller(
      makeContext({ db, userId: target.id, impersonator: { id: su.id, email: su.email } }),
    );

    const res = await caller.auth.stopImpersonation({});
    expect(res.id).toBe(su.id);
    expect(res.impersonator).toBeNull();
  });

  it("stops impersonation even when the impersonated user is unverified", async () => {
    const su = await seedUser(db, { email: "root@example.com", isSuperuser: true, verified: true });
    const target = await seedUser(db, { email: "unverified@example.com", verified: false });
    const caller = createCaller(
      makeContext({ db, userId: target.id, impersonator: { id: su.id, email: su.email } }),
    );

    const res = await caller.auth.stopImpersonation({});
    expect(res.id).toBe(su.id);
    expect(res.impersonator).toBeNull();
  });

  it("rejects stopImpersonation without an active impersonation", async () => {
    const user = await seedUser(db, { email: "plain@example.com", verified: true });
    const caller = createCaller(makeContext({ db, userId: user.id }));

    await expect(caller.auth.stopImpersonation({})).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
