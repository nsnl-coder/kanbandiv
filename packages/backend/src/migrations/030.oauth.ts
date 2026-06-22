import { type Kysely, sql } from "kysely";

// Link a user to an external identity provider (Google). Both nullable so
// password accounts are unaffected; password_hash stays NOT NULL (OAuth-created
// users get a random unusable hash). Partial unique index keeps one account per
// (provider, sub) while allowing many rows where both are NULL.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("users")
    .addColumn("oauth_provider", "text")
    .addColumn("oauth_sub", "text")
    .execute();

  await db.schema
    .createIndex("users_oauth_provider_sub_idx")
    .unique()
    .on("users")
    .columns(["oauth_provider", "oauth_sub"])
    .where(sql.ref("oauth_sub"), "is not", null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("users_oauth_provider_sub_idx").ifExists().execute();
  await db.schema.alterTable("users").dropColumn("oauth_sub").execute();
  await db.schema.alterTable("users").dropColumn("oauth_provider").execute();
}
