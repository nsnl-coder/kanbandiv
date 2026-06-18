import { AuthError, ProjectPermission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCaller, makeContext, newTestDb, type TestDb } from "./helpers.js";

describe("boards auth guard", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await newTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const anon = () => createCaller(makeContext({ db }));
  const id = "00000000-0000-0000-0000-000000000000";

  const cases: [string, () => Promise<unknown>][] = [
    ["list", () => anon().boards.list({ projectId: id })],
    ["get", () => anon().boards.get({ id })],
    ["getData", () => anon().boards.getData({ id })],
    ["create", () => anon().boards.create({ projectId: id, name: "X" })],
    ["update", () => anon().boards.update({ id, name: "X" })],
    ["delete", () => anon().boards.delete({ id })],
    ["accessList", () => anon().boards.accessList({ id })],
    [
      "accessGrant",
      () =>
        anon().boards.accessGrant({
          id,
          email: "x@example.com",
          permission: ProjectPermission.View,
        }),
    ],
    ["accessRevoke", () => anon().boards.accessRevoke({ id, userId: id })],
  ];

  for (const [name, call] of cases) {
    it(`${name} rejects an unauthenticated caller`, async () => {
      await expect(call()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: AuthError.SESSION_EXPIRED,
      });
    });
  }
});
