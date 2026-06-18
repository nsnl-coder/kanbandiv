import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("boards")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("project_id", "uuid", (c) =>
      c.notNull().references("projects.id").onDelete("cascade"),
    )
    .addColumn("owner_id", "uuid", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .addColumn("color", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("boards_project_idx")
    .on("boards")
    .column("project_id")
    .execute();

  await db.schema
    .createTable("board_access")
    .addColumn("board_id", "uuid", (c) =>
      c.notNull().references("boards.id").onDelete("cascade"),
    )
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("permission", "text", (c) => c.notNull())
    .addPrimaryKeyConstraint("board_access_pkey", ["board_id", "user_id"])
    .execute();

  await db.schema
    .createIndex("board_access_user_idx")
    .on("board_access")
    .column("user_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("board_access").ifExists().execute();
  await db.schema.dropTable("boards").ifExists().execute();
}
