import crypto from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/types.js";
import { down, up } from "./001.auth.js";

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

describe("001.auth migration", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = freshDb();
    await up(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function seedUserWithChildren(): Promise<string> {
    const user = await db
      .insertInto("users")
      .values({ email: "cascade@example.com", password_hash: "x" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("otp_codes")
      .values({
        user_id: user.id,
        code_hash: "h",
        purpose: "verify_email",
        expires_at: new Date(Date.now() + 60_000),
      })
      .execute();
    await db
      .insertInto("refresh_tokens")
      .values({
        user_id: user.id,
        token_hash: crypto.randomUUID(),
        family_id: crypto.randomUUID(),
        parent_id: null,
        expires_at: new Date(Date.now() + 60_000),
      })
      .execute();
    return user.id;
  }

  const count = async (table: "otp_codes" | "refresh_tokens", userId: string) => {
    const row = await db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow();
    return Number(row.c);
  };

  it("cascades deletes from users to otp_codes and refresh_tokens", async () => {
    const userId = await seedUserWithChildren();
    expect(await count("otp_codes", userId)).toBe(1);
    expect(await count("refresh_tokens", userId)).toBe(1);

    await db.deleteFrom("users").where("id", "=", userId).execute();

    expect(await count("otp_codes", userId)).toBe(0);
    expect(await count("refresh_tokens", userId)).toBe(0);
  });

  it("down drops every table", async () => {
    await down(db);
    for (const table of ["users", "otp_codes", "refresh_tokens", "auth_events"]) {
      await expect(
        sql`select 1 from ${sql.table(table)}`.execute(db),
      ).rejects.toThrow();
    }
  });
});
