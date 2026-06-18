import crypto from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/types.js";
import { up as up001 } from "./001.auth.js";
import { down, up } from "./002.rbac.js";

function freshDb(): Kysely<Database> {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  const { Pool } = mem.adapters.createPg();
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool() }) });
}

describe("002.rbac migration", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = freshDb();
    await up001(db);
    await up(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  const seedRole = (name: string) =>
    db
      .insertInto("roles")
      .values({ name })
      .returning("id")
      .executeTakeFirstOrThrow();

  const seedUser = (email: string, roleId: string | null = null) =>
    db
      .insertInto("users")
      .values({ email, password_hash: "x", role_id: roleId })
      .returning("id")
      .executeTakeFirstOrThrow();

  it("creates roles and role_permissions tables", async () => {
    await expect(sql`select 1 from roles`.execute(db)).resolves.toBeDefined();
    await expect(
      sql`select 1 from role_permissions`.execute(db),
    ).resolves.toBeDefined();
  });

  it("adds users.is_superuser (default false) and nullable users.role_id", async () => {
    const id = await seedUser("col@example.com");
    const row = await db
      .selectFrom("users")
      .select(["is_superuser", "role_id"])
      .where("id", "=", id.id)
      .executeTakeFirstOrThrow();
    expect(row.is_superuser).toBe(false);
    expect(row.role_id).toBeNull();
  });

  it("drops the users.role column", async () => {
    await seedUser("norole@example.com");
    await expect(sql`select role from users`.execute(db)).rejects.toThrow();
  });

  it("rejects a duplicate (role_id, permission) in role_permissions", async () => {
    const role = await seedRole("dup");
    await db
      .insertInto("role_permissions")
      .values({ role_id: role.id, permission: "admin:users:read" })
      .execute();
    await expect(
      db
        .insertInto("role_permissions")
        .values({ role_id: role.id, permission: "admin:users:read" })
        .execute(),
    ).rejects.toThrow();
  });

  it("cascades role deletion to role_permissions", async () => {
    const role = await seedRole("cascade");
    await db
      .insertInto("role_permissions")
      .values({ role_id: role.id, permission: "admin:roles:read" })
      .execute();

    await db.deleteFrom("roles").where("id", "=", role.id).execute();

    const rows = await db
      .selectFrom("role_permissions")
      .selectAll()
      .where("role_id", "=", role.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it("sets a user's role_id to null when its role is deleted", async () => {
    const role = await seedRole("assigned");
    const user = await seedUser("member@example.com", role.id);

    await db.deleteFrom("roles").where("id", "=", role.id).execute();

    const row = await db
      .selectFrom("users")
      .select(["id", "role_id"])
      .where("id", "=", user.id)
      .executeTakeFirst();
    expect(row?.id).toBe(user.id);
    expect(row?.role_id).toBeNull();
  });

  it("down drops roles and role_permissions and keeps users", async () => {
    await down(db);
    await expect(sql`select 1 from roles`.execute(db)).rejects.toThrow();
    await expect(
      sql`select 1 from role_permissions`.execute(db),
    ).rejects.toThrow();
    await expect(sql`select 1 from users`.execute(db)).resolves.toBeDefined();
  });
});
