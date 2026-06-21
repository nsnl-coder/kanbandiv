import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("attachments")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("card_id", "uuid", (c) =>
      c.notNull().references("cards.id").onDelete("cascade"),
    )
    .addColumn("uploader_id", "uuid", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("filename", "text", (c) => c.notNull())
    .addColumn("mime_type", "text", (c) => c.notNull())
    .addColumn("size_bytes", "bigint", (c) => c.notNull())
    .addColumn("storage_key", "text", (c) => c.notNull().unique())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("attachments_card_idx")
    .on("attachments")
    .column("card_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("attachments").ifExists().execute();
}
