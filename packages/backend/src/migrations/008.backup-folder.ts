import { type Kysely } from "kysely";

// Admin-managed Drive folder name (per-env default applied in the service when
// null), so local/dev/prod back up into separate folders.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("backup_settings")
    .addColumn("gdrive_folder_name", "text")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("backup_settings").dropColumn("gdrive_folder_name").execute();
}
