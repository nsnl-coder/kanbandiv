import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("boards")
    .addColumn("position", "double precision", (c) => c.notNull().defaultTo(0))
    .execute();

  // Backfill per project: seed positions from the previous default ordering.
  // Skipped when empty (a fresh DB / the in-memory test DB without window fns).
  const { rows } = await sql<{ c: number }>`SELECT count(*)::int AS c FROM boards`.execute(db);
  if ((rows[0]?.c ?? 0) > 0) {
    await sql`
      UPDATE boards AS b
      SET position = sub.rn
      FROM (
        SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY updated_at DESC) AS rn
        FROM boards
      ) AS sub
      WHERE b.id = sub.id
    `.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("boards").dropColumn("position").execute();
}
