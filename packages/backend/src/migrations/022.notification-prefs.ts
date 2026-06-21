import { type Kysely, sql } from "kysely";

// Per-user, per-type delivery switches. An ABSENT row means "all channels on"
// (the historical behaviour), so existing users keep getting every notification
// until they opt out. PK (user_id, type) makes the upsert a single conflict key.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("notification_prefs")
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("in_app", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("email", "boolean", (c) => c.notNull().defaultTo(true))
    .addPrimaryKeyConstraint("notification_prefs_pkey", ["user_id", "type"])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("notification_prefs").ifExists().execute();
}
