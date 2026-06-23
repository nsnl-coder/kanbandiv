import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("automation_rules")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("board_id", "uuid", (c) =>
      c.notNull().references("boards.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("enabled", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("trigger", "jsonb", (c) => c.notNull())
    .addColumn("actions", "jsonb", (c) => c.notNull())
    .addColumn("created_by", "uuid", (c) => c.references("users.id").onDelete("set null"))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("automation_rules_board_idx")
    .on("automation_rules")
    .column("board_id")
    .execute();

  await db.schema
    .createTable("automation_runs")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("rule_id", "uuid", (c) =>
      c.notNull().references("automation_rules.id").onDelete("cascade"),
    )
    .addColumn("card_id", "uuid")
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("detail", "jsonb", (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("automation_runs_rule_idx")
    .on("automation_runs")
    .column("rule_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("automation_runs").ifExists().execute();
  await db.schema.dropTable("automation_rules").ifExists().execute();
}
