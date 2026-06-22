import { type Kysely, sql } from "kysely";

// User-filed bug reports triaged by admins through a status lifecycle. reporter_id
// is set NULL (not cascade) when the account is removed so the report survives.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("bug_reports")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("reporter_id", "uuid", (c) =>
      c.references("users.id").onDelete("set null"),
    )
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("description", "text", (c) => c.notNull())
    .addColumn("severity", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull().defaultTo("open"))
    .addColumn("page_url", "text")
    .addColumn("user_agent", "text")
    .addColumn("resolution", "text")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("bug_reports_reporter_created_idx")
    .on("bug_reports")
    .columns(["reporter_id", "created_at desc"])
    .execute();

  await db.schema
    .createIndex("bug_reports_status_created_idx")
    .on("bug_reports")
    .columns(["status", "created_at desc"])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("bug_reports").ifExists().execute();
}
