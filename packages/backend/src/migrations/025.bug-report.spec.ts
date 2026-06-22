import crypto from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/types.js";
import { up as up001 } from "./001.auth.js";
import { down, up } from "./025.bug-report.js";

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

describe("025 bug-report migration", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = freshDb();
    await up001(db);
    await up(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  function seedUser() {
    return db
      .insertInto("users")
      .values({ email: "u@example.com", password_hash: "x" })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  it("up runs (table + both indexes boot)", async () => {
    const fresh = freshDb();
    await up001(fresh);
    await expect(up(fresh)).resolves.not.toThrow();
    await fresh.destroy();
  });

  it("inserts a row with defaults", async () => {
    const user = await seedUser();
    await db
      .insertInto("bug_reports")
      .values({
        reporter_id: user.id,
        title: "Broken",
        description: "It broke",
        severity: "high",
      })
      .execute();
    const row = await db
      .selectFrom("bug_reports")
      .selectAll()
      .where("reporter_id", "=", user.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("open");
    expect(row.resolution).toBeNull();
    expect(row.created_at).toBeTruthy();
  });

  it("sets reporter_id NULL (not cascade) when the reporter is deleted", async () => {
    const user = await seedUser();
    await db
      .insertInto("bug_reports")
      .values({
        reporter_id: user.id,
        title: "Broken",
        description: "It broke",
        severity: "low",
      })
      .execute();
    await db.deleteFrom("users").where("id", "=", user.id).execute();
    const rows = await db.selectFrom("bug_reports").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].reporter_id).toBeNull();
  });

  it("down drops the table", async () => {
    await down(db);
    await expect(
      sql`select 1 from ${sql.table("bug_reports")}`.execute(db),
    ).rejects.toThrow();
  });
});
