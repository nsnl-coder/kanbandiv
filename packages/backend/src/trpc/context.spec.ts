import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { signAccessToken } from "../features/auth/auth.service.js";
import { createContext } from "./context.js";

type Args = Parameters<typeof createContext>[0];

function make(headers: Record<string, string>, ip?: string): Args {
  return {
    req: { headers, ip },
    res: {} as never,
  } as unknown as Args;
}

const user = {
  id: crypto.randomUUID(),
  email: "ctx@example.com",
  isSuperuser: false,
  emailVerified: true,
};

describe("createContext", () => {
  it("extracts userId from a valid access_token cookie", () => {
    const token = signAccessToken(user);
    const ctx = createContext(make({ cookie: `access_token=${token}` }));
    expect(ctx.userId).toBe(user.id);
  });

  it("returns null userId for a malformed access_token cookie", () => {
    const ctx = createContext(make({ cookie: "access_token=not-a-jwt" }));
    expect(ctx.userId).toBeNull();
  });

  it("returns null userId when there is no access_token cookie", () => {
    const ctx = createContext(make({}));
    expect(ctx.userId).toBeNull();
  });

  it("returns null userId for an empty access_token cookie", () => {
    const ctx = createContext(make({ cookie: "access_token=" }));
    expect(ctx.userId).toBeNull();
  });

  it("parses access_token and refresh_token independently when both are present", () => {
    const token = signAccessToken(user);
    const ctx = createContext(
      make({ cookie: `access_token=${token}; refresh_token=raw-refresh` }),
    );
    expect(ctx.userId).toBe(user.id);
    expect(ctx.refreshCookie).toBe("raw-refresh");
  });

  it("ignores a Bearer Authorization header (cookie-only auth)", () => {
    const token = signAccessToken(user);
    const ctx = createContext(make({ authorization: `Bearer ${token}` }));
    expect(ctx.userId).toBeNull();
  });

  it("parses the refresh_token cookie", () => {
    const ctx = createContext(make({ cookie: "refresh_token=raw-token-value; other=1" }));
    expect(ctx.refreshCookie).toBe("raw-token-value");
  });

  it("exposes ip and user-agent", () => {
    const ctx = createContext(make({ "user-agent": "vitest-agent" }, "203.0.113.7"));
    expect(ctx.ip).toBe("203.0.113.7");
    expect(ctx.userAgent).toBe("vitest-agent");
  });
});
