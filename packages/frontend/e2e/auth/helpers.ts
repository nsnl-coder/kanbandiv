import { type Page, type Route, expect } from "@playwright/test";
import type { PublicUser } from "shared";

// --- tRPC over HTTP mock -----------------------------------------------------
// The frontend talks to the backend via httpBatchLink + superjson. We intercept
// `/trpc/**` in the browser and answer with the exact wire envelopes tRPC v11
// expects, so no backend or DB is needed.
//
// Wire format (superjson transformer):
//   success: { result: { data: { json: <value> } } }
//   error:   { error:  { json: { message, code, data: { code, httpStatus } } } }
// Batched requests (?batch=1) wrap the items in an array, in path order.

type TrpcCodeKey =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_SERVER_ERROR";

const CODE_NUM: Record<TrpcCodeKey, number> = {
  BAD_REQUEST: -32600,
  INTERNAL_SERVER_ERROR: -32603,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  CONFLICT: -32009,
  TOO_MANY_REQUESTS: -32029,
};

const HTTP_STATUS: Record<TrpcCodeKey, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
};

interface ErrSpec {
  code: TrpcCodeKey;
  message: string;
}
type Responder = { kind: "ok"; data: unknown } | { kind: "err"; err: ErrSpec };

export function makeUser(over: Partial<PublicUser> = {}): PublicUser {
  return {
    id: "u_1",
    email: "user@example.com",
    role: "user",
    emailVerified: true,
    ...over,
  };
}

// login/refresh return just the public user; tokens live in httpOnly cookies.
export function makeSession(user: PublicUser): PublicUser {
  return user;
}

export class TrpcMock {
  private responders = new Map<string, Responder>();

  constructor(private readonly page: Page) {}

  ok(path: string, data: unknown): this {
    this.responders.set(path, { kind: "ok", data });
    return this;
  }

  err(path: string, err: ErrSpec): this {
    this.responders.set(path, { kind: "err", err });
    return this;
  }

  /** Default logged-out: refresh fails so the app boots unauthenticated. */
  loggedOut(): this {
    return this.err("auth.refresh", {
      code: "UNAUTHORIZED",
      message: "INVALID_REFRESH_TOKEN",
    });
  }

  /** Logged in: a full reload re-hydrates the store via the refresh cookie. */
  loggedIn(user: PublicUser): this {
    return this.ok("auth.refresh", user);
  }

  async install(): Promise<this> {
    if (!this.responders.has("auth.refresh")) this.loggedOut();
    await this.page.route("**/trpc/**", (route) => this.handle(route));
    return this;
  }

  private envelope(r: Responder): unknown {
    if (r.kind === "ok") return { result: { data: { json: r.data } } };
    const { code, message } = r.err;
    return {
      error: {
        json: { message, code: CODE_NUM[code], data: { code, httpStatus: HTTP_STATUS[code] } },
      },
    };
  }

  private async handle(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    const after = url.pathname.replace(/^.*\/trpc\//, "");
    const procs = after.split(",").map((p) => decodeURIComponent(p));
    const isBatch = url.searchParams.get("batch") === "1";

    const items = procs.map((path) => {
      const r =
        this.responders.get(path) ??
        ({ kind: "err", err: { code: "NOT_FOUND", message: `no mock: ${path}` } } as Responder);
      return this.envelope(r);
    });

    // Logout revokes the refresh token: subsequent refreshes must fail, so a
    // guest route can't silently re-hydrate the session the user just ended.
    if (procs.includes("auth.logout")) this.loggedOut();

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(isBatch ? items : items[0]),
    });
  }
}

export async function getStore(page: Page): Promise<{ user: PublicUser | null }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __authStore: { getState: () => unknown } }).__authStore;
    const st = s.getState() as { user: PublicUser | null };
    return { user: st.user };
  });
}

export async function expectLoggedOut(page: Page): Promise<void> {
  const store = await getStore(page);
  expect(store.user).toBeNull();
}
