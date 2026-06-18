import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("users")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("email", "text", (c) => c.notNull().unique())
    .addColumn("password_hash", "text", (c) => c.notNull())
    .addColumn("email_verified", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("role", "text", (c) => c.notNull().defaultTo("user"))
    .addColumn("failed_login_count", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("locked_until", "timestamptz")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("otp_codes")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("code_hash", "text", (c) => c.notNull())
    .addColumn("purpose", "text", (c) => c.notNull())
    .addColumn("expires_at", "timestamptz", (c) => c.notNull())
    .addColumn("consumed_at", "timestamptz")
    .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("refresh_tokens")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("token_hash", "text", (c) => c.notNull().unique())
    .addColumn("family_id", "uuid", (c) => c.notNull())
    .addColumn("parent_id", "uuid")
    .addColumn("expires_at", "timestamptz", (c) => c.notNull())
    .addColumn("revoked_at", "timestamptz")
    .addColumn("reused_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("auth_events")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid")
    .addColumn("event", "text", (c) => c.notNull())
    .addColumn("ip", "text")
    .addColumn("user_agent", "text")
    .addColumn("outcome", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("otp_codes_user_purpose_idx")
    .on("otp_codes")
    .columns(["user_id", "purpose"])
    .execute();

  await db.schema
    .createIndex("refresh_tokens_family_idx")
    .on("refresh_tokens")
    .column("family_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("auth_events").ifExists().execute();
  await db.schema.dropTable("refresh_tokens").ifExists().execute();
  await db.schema.dropTable("otp_codes").ifExists().execute();
  await db.schema.dropTable("users").ifExists().execute();
}
