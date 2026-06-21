import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  try {
    // Real Postgres path: generated tsvector (title weight A, description B) + GIN.
    await sql`
      ALTER TABLE cards ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(description, '')), 'B')
        ) STORED
    `.execute(db);
    await sql`CREATE INDEX cards_search_vector_idx ON cards USING gin (search_vector)`.execute(db);
  } catch (err) {
    // pg-mem (tests) has no tsvector/GIN. Degrade to a plain text column so the
    // column EXISTS and no-text-path queries still run. Full-text behavior is
    // exercised on live Postgres only (CLAUDE.md). Re-throw anything that is NOT
    // the known pg-mem limitation so a real prod failure is not swallowed.
    if (!/tsvector|gin|generated/i.test(String((err as Error).message))) throw err;
    await sql`ALTER TABLE cards ADD COLUMN search_vector text`.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS cards_search_vector_idx`.execute(db);
  await sql`ALTER TABLE cards DROP COLUMN IF EXISTS search_vector`.execute(db);
}
