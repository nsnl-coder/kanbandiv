import crypto from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/types.js";
import { up as up001 } from "./001.auth.js";
import { up as up003 } from "./003.project.js";
import { up as up004 } from "./004.board.js";
import { up as up005 } from "./005.column.js";
import { up as up006 } from "./006.card.js";
import { down, up } from "./017.card-search.js";

// On pg-mem `up` takes the text-column fallback (no tsvector/GIN). The real
// generated tsvector + GIN DDL is validated on live Postgres via
// `pnpm --filter backend migrate`.
function freshDb(): Kysely<Database> {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  const { Pool } = mem.adapters.createPg();
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool() }) });
}

describe("017 card-search migration", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = freshDb();
    await up001(db);
    await up003(db);
    await up004(db);
    await up005(db);
    await up006(db);
    await up(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("adds a search_vector column (text fallback under pg-mem)", async () => {
    await expect(sql`select search_vector from cards`.execute(db)).resolves.toBeDefined();
  });

  it("down drops the search_vector column", async () => {
    await down(db);
    await expect(sql`select search_vector from cards`.execute(db)).rejects.toThrow();
  });
});
