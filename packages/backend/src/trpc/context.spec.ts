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
  role: "user" as const,
  emailVerified: true,
};

describe("createContext", () => {
  it("extracts userId from a valid Bearer token", () => {
    const token = signAccessToken(user);
    const ctx = createContext(make({ authorization: `Bearer ${token}` }));
    expect(ctx.userId).toBe(user.id);
  });

  it("returns null userId for a malformed Bearer token", () => {
    const ctx = createContext(make({ authorization: "Bearer not-a-jwt" }));
    expect(ctx.userId).toBeNull();
  });

  it("returns null userId when there is no Authorization header", () => {
    const ctx = createContext(make({}));
    expect(ctx.userId).toBeNull();
  });

  it("ignores a non-Bearer Authorization scheme", () => {
    const ctx = createContext(make({ authorization: "Basic abc123" }));
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
