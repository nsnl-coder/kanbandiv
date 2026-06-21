import crypto from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/types.js";
import { up as up001 } from "./001.auth.js";
import { down, up } from "./020.notification.js";

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

describe("020 notification migration", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = freshDb();
    await up001(db);
    await up(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function seedUser() {
    return db
      .insertInto("users")
      .values({ email: "u@example.com", password_hash: "x" })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  it("up runs (table + both indexes incl. the partial unread index boot under pg-mem)", async () => {
    // up already ran in beforeEach; a fresh db proves both createIndex calls boot.
    const fresh = freshDb();
    await up001(fresh);
    await expect(up(fresh)).resolves.not.toThrow();
    await fresh.destroy();
  });

  it("inserts a row with a jsonb payload and reads it back parsed", async () => {
    const user = await seedUser();
    await db
      .insertInto("notifications")
      .values({
        user_id: user.id,
        type: "MENTION",
        payload: JSON.stringify({
          boardId: "b1",
          cardId: "c1",
          actorHandle: "alice",
          title: "Card",
          snippet: "hi",
        }),
      })
      .execute();
    const row = await db
      .selectFrom("notifications")
      .selectAll()
      .where("user_id", "=", user.id)
      .executeTakeFirstOrThrow();
    expect(row.read_at).toBeNull();
    expect(row.payload).toEqual({
      boardId: "b1",
      cardId: "c1",
      actorHandle: "alice",
      title: "Card",
      snippet: "hi",
    });
  });

  it("cascades rows when the user is deleted", async () => {
    const user = await seedUser();
    await db
      .insertInto("notifications")
      .values({
        user_id: user.id,
        type: "MENTION",
        payload: JSON.stringify({ boardId: "b1", actorHandle: null, title: "T" }),
      })
      .execute();
    await db.deleteFrom("users").where("id", "=", user.id).execute();
    const rows = await db.selectFrom("notifications").selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it("down drops the table", async () => {
    await down(db);
    await expect(
      sql`select 1 from ${sql.table("notifications")}`.execute(db),
    ).rejects.toThrow();
  });
});
