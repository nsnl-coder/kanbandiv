import { type Kysely, sql } from "kysely";

// Marks dedicated e2e test accounts. Such users are exempt from the per-IP auth
// rate limiter (the suite hammers login from one IP behind Cloudflare, which
// collapses the per-test X-Forwarded-For into one bucket). Default false so real
// users are always rate-limited.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("users")
    .addColumn("is_test", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("users").dropColumn("is_test").execute();
}
