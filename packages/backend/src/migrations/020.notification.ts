import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("notifications")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("payload", "jsonb", (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("read_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("notifications_user_created_idx")
    .on("notifications")
    .columns(["user_id", "created_at desc"])
    .execute();

  // Partial index for the unread-count + unread badge (small, hot index).
  await db.schema
    .createIndex("notifications_user_unread_idx")
    .on("notifications")
    .column("user_id")
    .where(sql.ref("read_at"), "is", null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("notifications").ifExists().execute();
}
