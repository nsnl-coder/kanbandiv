import { type Kysely, sql } from "kysely";

// Per-user ordering for projects (used for the "Shared with me" list, where the
// viewer is not the owner and so cannot change the project's global position).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("project_user_order")
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("project_id", "uuid", (c) =>
      c.notNull().references("projects.id").onDelete("cascade"),
    )
    .addColumn("position", "double precision", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("project_user_order_pkey", ["user_id", "project_id"])
    .execute();

  await db.schema
    .createIndex("project_user_order_user_idx")
    .on("project_user_order")
    .column("user_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("project_user_order").ifExists().execute();
}
