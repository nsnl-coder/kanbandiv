import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("activities")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("board_id", "uuid", (c) =>
      c.notNull().references("boards.id").onDelete("cascade"),
    )
    .addColumn("card_id", "uuid", (c) =>
      c.references("cards.id").onDelete("set null"),
    )
    .addColumn("actor_id", "uuid", (c) =>
      c.references("users.id").onDelete("set null"),
    )
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("meta", "jsonb", (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("activities_board_created_idx")
    .on("activities")
    .columns(["board_id", "created_at desc"])
    .execute();

  await db.schema
    .createIndex("activities_card_created_idx")
    .on("activities")
    .columns(["card_id", "created_at desc"])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("activities").ifExists().execute();
}
