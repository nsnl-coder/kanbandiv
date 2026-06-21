import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("board_views")
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("board_id", "uuid", (c) =>
      c.notNull().references("boards.id").onDelete("cascade"),
    )
    .addColumn("mode", "text", (c) => c.notNull().defaultTo("kanban"))
    .addColumn("config", "jsonb", (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("board_views_pkey", ["user_id", "board_id"])
    .execute();
  // PK already covers the (user_id, board_id) point lookup; no extra index needed.
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("board_views").ifExists().execute();
}
