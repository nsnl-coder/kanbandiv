import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // Singleton settings row (id is always 1).
  await db.schema
    .createTable("backup_settings")
    .addColumn("id", "integer", (c) => c.primaryKey())
    .addColumn("enabled", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("schedule_kind", "text", (c) => c.notNull().defaultTo("daily"))
    .addColumn("cron_expr", "text")
    .addColumn("retention_mode", "text", (c) => c.notNull().defaultTo("simple"))
    .addColumn("retention_days", "integer")
    .addColumn("gfs_daily", "integer")
    .addColumn("gfs_weekly", "integer")
    .addColumn("gfs_monthly", "integer")
    .addColumn("include_minio", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("encryption_enabled", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("gdrive_email", "text")
    .addColumn("gdrive_refresh_token", "text")
    .addColumn("gdrive_folder_id", "text")
    .addColumn("maintenance", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // Seed the singleton with defaults (simple retention, 14 days).
  await db
    .insertInto("backup_settings" as any)
    .values({ id: 1, retention_days: 14 } as any)
    .execute();

  await db.schema
    .createTable("backup_runs")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("started_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("finished_at", "timestamptz")
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("trigger", "text", (c) => c.notNull())
    .addColumn("size_bytes", "bigint")
    .addColumn("drive_file_id", "text")
    .addColumn("file_name", "text", (c) => c.notNull())
    .addColumn("checksum", "text")
    .addColumn("error", "text")
    .addColumn("expires_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("backup_runs_started_idx")
    .on("backup_runs")
    .column("started_at")
    .execute();

  await db.schema
    .createIndex("backup_runs_status_idx")
    .on("backup_runs")
    .column("status")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("backup_runs").ifExists().execute();
  await db.schema.dropTable("backup_settings").ifExists().execute();
}
