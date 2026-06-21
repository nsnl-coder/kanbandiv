import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PublicUser } from "shared";
import { env } from "../../../config/env.config.js";
import { signAccessToken } from "../../auth/auth.service.js";
import { newTestDb, seedUser, type TestDb } from "../../auth/test/helpers.js";
import {
  isAllowedHost,
  resolveAdmin,
  signSessionToken,
  signSsoToken,
  signTransferToken,
  targetHostFromReturnUrl,
  verifySsoToken,
} from "../sso.service.js";

const MON = "monitor.trello-clone.shop";
const MIN = "minio.trello-clone.shop";

function accessTokenFor(id: string, email: string): string {
  return signAccessToken({ id, email } as PublicUser);
}

describe("sso.service security", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  describe("resolveAdmin (the admin gate)", () => {
    it("unauthenticated when no token is present", async () => {
      expect(await resolveAdmin(db, undefined)).toEqual({ status: "unauthenticated" });
    });

    it("unauthenticated for a garbage/forged access token", async () => {
      expect(await resolveAdmin(db, "not-a-jwt")).toEqual({ status: "unauthenticated" });
      const forged = jwt.sign({ sub: crypto.randomUUID() }, "wrong-secret-wrong-secret-wrong!", {
        algorithm: "HS256",
        audience: env.JWT_AUD,
        issuer: env.JWT_ISS,
      });
      expect(await resolveAdmin(db, forged)).toEqual({ status: "unauthenticated" });
    });

    it("forbidden for a valid non-superuser session", async () => {
      const u = await seedUser(db, { email: "user@example.com", isSuperuser: false });
      const r = await resolveAdmin(db, accessTokenFor(u.id, u.email));
      expect(r.status).toBe("forbidden");
    });

    it("forbidden when the user no longer exists (token still valid)", async () => {
      const ghost = accessTokenFor(crypto.randomUUID(), "ghost@example.com");
      const r = await resolveAdmin(db, ghost);
      expect(r.status).toBe("forbidden");
    });

    it("ok only for a super-admin, returning identity", async () => {
      const u = await seedUser(db, { email: "root@example.com", isSuperuser: true });
      const r = await resolveAdmin(db, accessTokenFor(u.id, u.email));
      expect(r).toMatchObject({ status: "ok", sub: u.id, email: "root@example.com" });
    });
  });

  describe("token audience binding (no cross-service reuse)", () => {
    const claims = { sub: "u1", email: "root@example.com" };

    it("a session token for monitor verifies on monitor", () => {
      const tok = signSessionToken(claims, MON);
      expect(verifySsoToken(tok, MON).email).toBe("root@example.com");
    });

    it("a monitor token is REJECTED on minio", () => {
      const tok = signSessionToken(claims, MON);
      expect(() => verifySsoToken(tok, MIN)).toThrow();
    });

    it("a transfer token is host-bound the same way", () => {
      const tok = signTransferToken(claims, MIN);
      expect(verifySsoToken(tok, MIN).sub).toBe("u1");
      expect(() => verifySsoToken(tok, MON)).toThrow();
    });
  });

  describe("verifySsoToken rejects tampered/invalid tokens", () => {
    const claims = { sub: "u1", email: "a@b.c" };

    it("rejects the wrong signing secret", () => {
      const tok = jwt.sign({ email: claims.email }, "another-secret-another-secret-xx", {
        algorithm: "HS256",
        subject: claims.sub,
        audience: MON,
        issuer: "trello-sso",
      });
      expect(() => verifySsoToken(tok, MON)).toThrow();
    });

    it("rejects an expired token", () => {
      const tok = signSsoToken(claims, MON, -1);
      expect(() => verifySsoToken(tok, MON)).toThrow();
    });

    it("rejects the 'none' algorithm", () => {
      const tok = jwt.sign({ email: claims.email }, "", {
        algorithm: "none",
        subject: claims.sub,
        audience: MON,
        issuer: "trello-sso",
      });
      expect(() => verifySsoToken(tok, MON)).toThrow();
    });

    it("rejects a wrong issuer", () => {
      const tok = jwt.sign({ email: claims.email }, env.SSO_SECRET, {
        algorithm: "HS256",
        subject: claims.sub,
        audience: MON,
        issuer: "evil",
      });
      expect(() => verifySsoToken(tok, MON)).toThrow();
    });
  });

  describe("host allowlist + return-url parsing (anti open-redirect)", () => {
    const allow = [MON, MIN];

    it("allows only configured hosts", () => {
      expect(isAllowedHost(MON, allow)).toBe(true);
      expect(isAllowedHost(MIN, allow)).toBe(true);
      expect(isAllowedHost("evil.com", allow)).toBe(false);
      expect(isAllowedHost("", allow)).toBe(false);
    });

    it("extracts the host from a return url", () => {
      expect(targetHostFromReturnUrl(`https://${MON}/d/abc`)).toBe(MON);
    });

    it("rejects non-http(s) and garbage return urls", () => {
      expect(targetHostFromReturnUrl("javascript:alert(1)")).toBeNull();
      expect(targetHostFromReturnUrl("not a url")).toBeNull();
      expect(targetHostFromReturnUrl("ftp://x/y")).toBeNull();
    });

    it("an attacker host in rd is not in the allowlist", () => {
      const host = targetHostFromReturnUrl("https://evil.com/steal");
      expect(host).toBe("evil.com");
      expect(isAllowedHost(host as string, allow)).toBe(false);
    });
  });
});
