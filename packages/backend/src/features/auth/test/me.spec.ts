import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../../config/env.config.js";
import { signAccessToken, verifyAccessToken } from "../auth.service.js";
import { createCaller, makeContext, newTestDb, seedUser, type TestDb } from "./helpers.js";

describe("auth.me", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("endpoint", () => {
    it("returns {id,email,isSuperuser,roleId,emailVerified} for the authed user", async () => {
      const user = await seedUser(db, { email: "me@example.com", verified: true });
      const caller = createCaller(makeContext({ db, userId: user.id }));
      const res = await caller.auth.me({});
      expect(res).toEqual({
        id: user.id,
        email: "me@example.com",
        isSuperuser: false,
        roleId: null,
        emailVerified: true,
        permissions: [],
      });
    });

    it("excludes password_hash", async () => {
      const user = await seedUser(db, { email: "secret@example.com" });
      const caller = createCaller(makeContext({ db, userId: user.id }));
      const res = await caller.auth.me({});
      expect("password_hash" in res).toBe(false);
      expect(Object.keys(res).sort()).toEqual([
        "email",
        "emailVerified",
        "id",
        "isSuperuser",
        "permissions",
        "roleId",
      ]);
    });

    it("reflects the superuser flag", async () => {
      const user = await seedUser(db, { email: "root@example.com", isSuperuser: true });
      const caller = createCaller(makeContext({ db, userId: user.id }));
      const res = await caller.auth.me({});
      expect(res.isSuperuser).toBe(true);
    });

    it("rejects an unauthenticated call (userId null) with UNAUTHORIZED", async () => {
      const caller = createCaller(makeContext({ db, userId: null }));
      await expect(caller.auth.me({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("rejects a non-existent user with UNAUTHORIZED", async () => {
      const caller = createCaller(makeContext({ db, userId: crypto.randomUUID() }));
      await expect(caller.auth.me({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("verifyAccessToken", () => {
    const user = {
      id: crypto.randomUUID(),
      email: "tok@example.com",
      isSuperuser: false,
      emailVerified: true,
      permissions: [],
    };

    it("accepts a token from signAccessToken (sub matches user id)", () => {
      const token = signAccessToken(user);
      expect(verifyAccessToken(token).sub).toBe(user.id);
    });

    it("rejects a token signed with the wrong secret", () => {
      const token = jwt.sign({ sub: user.id }, "wrong_secret", {
        algorithm: "HS256",
        expiresIn: "15m",
        issuer: env.JWT_ISS,
        audience: env.JWT_AUD,
      });
      expect(() => verifyAccessToken(token)).toThrow();
    });

    it("rejects an expired token", () => {
      const token = jwt.sign({ sub: user.id }, env.JWT_ACCESS_SECRET, {
        algorithm: "HS256",
        expiresIn: "-1s",
        issuer: env.JWT_ISS,
        audience: env.JWT_AUD,
      });
      expect(() => verifyAccessToken(token)).toThrow();
    });

    it("rejects a token signed with the 'none' algorithm", () => {
      const token = jwt.sign({ sub: user.id }, "", {
        algorithm: "none",
        issuer: env.JWT_ISS,
        audience: env.JWT_AUD,
      });
      expect(() => verifyAccessToken(token)).toThrow();
    });

    it("rejects a token with the wrong issuer", () => {
      const token = jwt.sign({ sub: user.id }, env.JWT_ACCESS_SECRET, {
        algorithm: "HS256",
        expiresIn: "15m",
        issuer: "evil-issuer",
        audience: env.JWT_AUD,
      });
      expect(() => verifyAccessToken(token)).toThrow();
    });

    it("rejects a token with the wrong audience", () => {
      const token = jwt.sign({ sub: user.id }, env.JWT_ACCESS_SECRET, {
        algorithm: "HS256",
        expiresIn: "15m",
        issuer: env.JWT_ISS,
        audience: "evil-audience",
      });
      expect(() => verifyAccessToken(token)).toThrow();
    });
  });
});
