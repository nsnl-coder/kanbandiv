import { type Kysely, sql } from "kysely";

// Pending access grants for emails that have no account YET. On the invitee's
// signup+verify the matching rows are converted into real project/board access
// and deleted. scope_id is a plain uuid (it points at either projects.id or
// boards.id depending on scope, so it cannot FK to a single table).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("invites")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("email", "text", (c) => c.notNull())
    .addColumn("scope", "text", (c) => c.notNull())
    .addColumn("scope_id", "uuid", (c) => c.notNull())
    .addColumn("permission", "text", (c) => c.notNull())
    .addColumn("invited_by", "uuid", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("invites_email_scope_unique", ["email", "scope", "scope_id"])
    .execute();

  // Hot path on signup: "any invites for this email?"
  await db.schema
    .createIndex("invites_email_idx")
    .on("invites")
    .column("email")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("invites").ifExists().execute();
}
