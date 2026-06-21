import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  for (const t of ["boards", "columns", "cards"] as const) {
    await db.schema
      .alterTable(t)
      .addColumn("archived_at", "timestamptz") // nullable = active
      .execute();
  }
  // Partial indexes accelerate the "active rows" reads (the hot path). The
  // .where(sql.ref(...), "is", null) builder form is proven on pg-mem
  // (010.card-due-date.ts).
  await db.schema
    .createIndex("boards_active_idx")
    .on("boards")
    .columns(["project_id"])
    .where(sql.ref("archived_at"), "is", null)
    .execute();
  await db.schema
    .createIndex("columns_active_idx")
    .on("columns")
    .columns(["board_id"])
    .where(sql.ref("archived_at"), "is", null)
    .execute();
  await db.schema
    .createIndex("cards_active_idx")
    .on("cards")
    .columns(["column_id"])
    .where(sql.ref("archived_at"), "is", null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const i of ["boards_active_idx", "columns_active_idx", "cards_active_idx"]) {
    await db.schema.dropIndex(i).ifExists().execute();
  }
  for (const t of ["boards", "columns", "cards"] as const) {
    await db.schema.alterTable(t).dropColumn("archived_at").execute();
  }
}
