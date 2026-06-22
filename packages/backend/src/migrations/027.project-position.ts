import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("projects")
    .addColumn("position", "double precision", (c) => c.notNull().defaultTo(0))
    .execute();

  // Backfill: seed positions from the previous default ordering. Skipped when
  // empty (a fresh DB / the in-memory test DB, which lacks window functions).
  const { rows } = await sql<{ c: number }>`SELECT count(*)::int AS c FROM projects`.execute(db);
  if ((rows[0]?.c ?? 0) > 0) {
    await sql`
      UPDATE projects AS p
      SET position = sub.rn
      FROM (
        SELECT id, row_number() OVER (ORDER BY updated_at DESC) AS rn
        FROM projects
      ) AS sub
      WHERE p.id = sub.id
    `.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("projects").dropColumn("position").execute();
}
