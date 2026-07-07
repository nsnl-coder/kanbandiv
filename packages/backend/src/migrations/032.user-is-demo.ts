import { type Kysely } from "kysely";

// Marks throwaway one-click demo accounts (GET /api/auth/demo). Such users get
// a random unusable password, are auto-verified, and are swept (with all their
// content, via FK cascades) once older than the demo retention window. Default
// false so real accounts are never swept.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("users")
    .addColumn("is_demo", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("users").dropColumn("is_demo").execute();
}
