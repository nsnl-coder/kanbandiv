import { type Kysely, sql } from "kysely";

// Files attached to a bug report. Cascade-deleted with the report; uploader_id is
// set NULL (not cascade) when the account is removed so the file row survives.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("bug_report_attachments")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("bug_report_id", "uuid", (c) =>
      c.notNull().references("bug_reports.id").onDelete("cascade"),
    )
    .addColumn("uploader_id", "uuid", (c) =>
      c.references("users.id").onDelete("set null"),
    )
    .addColumn("filename", "text", (c) => c.notNull())
    .addColumn("mime_type", "text", (c) => c.notNull())
    .addColumn("size_bytes", "bigint", (c) => c.notNull())
    .addColumn("storage_key", "text", (c) => c.notNull().unique())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("bug_report_attachments_report_idx")
    .on("bug_report_attachments")
    .column("bug_report_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("bug_report_attachments").ifExists().execute();
}
