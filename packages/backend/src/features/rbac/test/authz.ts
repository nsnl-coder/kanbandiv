import { AuthError, type Permission, RbacError } from "shared";
import { expect, it } from "vitest";
import {
  authedCaller,
  createCaller,
  makeContext,
  seedUserWithRole,
  superuserCaller,
  type TestDb,
} from "./helpers.js";
import type { AppCaller } from "./helpers.js";

const OTHER_PERM = "admin:roles:read" as Permission;
const FALLBACK_PERM = "admin:users:read" as Permission;

type Invoke = (caller: AppCaller) => Promise<unknown>;

/**
 * Emit the SU / HAS / LACKS / ANON authz matrix for one guarded endpoint.
 * `guard` is the permission the endpoint requires.
 * `invoke` calls the endpoint on a given caller with a valid-shaped input.
 */
export function authzMatrix(
  getDb: () => TestDb,
  guard: Permission,
  invoke: Invoke,
) {
  const lacking = guard === OTHER_PERM ? FALLBACK_PERM : OTHER_PERM;

  // SU/HAS assert the guard is passed: any rejection must be a domain error,
  // never the authz codes. (The probe input may reference a missing row.)
  const notBlocked = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      expect(e).not.toMatchObject({ code: "FORBIDDEN" });
      expect(e).not.toMatchObject({ code: "UNAUTHORIZED" });
    }
  };

  it("SU: superuser is allowed (bypass)", async () => {
    const { caller } = await superuserCaller(getDb());
    await notBlocked(invoke(caller));
  });

  it("HAS: a user whose role has the guard permission is allowed", async () => {
    const { user } = await seedUserWithRole(getDb(), {
      email: `has-${guard}@example.com`,
      permissions: [guard],
    });
    await notBlocked(invoke(authedCaller(getDb(), user.id)));
  });

  it("LACKS: a user without the guard permission is FORBIDDEN", async () => {
    const { user } = await seedUserWithRole(getDb(), {
      email: `lacks-${guard}@example.com`,
      permissions: [lacking],
    });
    await expect(
      invoke(authedCaller(getDb(), user.id)),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: RbacError.FORBIDDEN });
  });

  it("ANON: an unauthenticated call is UNAUTHORIZED / SESSION_EXPIRED", async () => {
    const caller = createCaller(makeContext({ db: getDb(), userId: null }));
    await expect(invoke(caller)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: AuthError.SESSION_EXPIRED,
    });
  });
}
