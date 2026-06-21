import crypto from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/types.js";
import { up as up001 } from "./001.auth.js";
import { up as up003 } from "./003.project.js";
import { up as up004 } from "./004.board.js";
import { down, up } from "./021.card-template.js";

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

describe("021 card-template migration", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = freshDb();
    await up001(db);
    await up003(db);
    await up004(db);
    await up(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function seedTree() {
    const user = await db
      .insertInto("users")
      .values({ email: "u@example.com", password_hash: "x" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const project = await db
      .insertInto("projects")
      .values({ owner_id: user.id, name: "P", color: "#000000" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const board = await db
      .insertInto("boards")
      .values({ project_id: project.id, owner_id: user.id, name: "B", color: "#000000" })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { user, board };
  }

  it("up creates card_templates with a board_id index", async () => {
    const { board } = await seedTree();
    await db
      .insertInto("card_templates")
      .values({ board_id: board.id, name: "T", payload: JSON.stringify({}) })
      .execute();
    const rows = await db
      .selectFrom("card_templates")
      .selectAll()
      .where("board_id", "=", board.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it("jsonb payload round-trips via JSON.stringify", async () => {
    const { board } = await seedTree();
    const payload = {
      description: "d",
      coverColor: "blue",
      labelIds: ["L1", "L2"],
      checklists: [{ title: "C", items: ["a", "b"] }],
    };
    await db
      .insertInto("card_templates")
      .values({ board_id: board.id, name: "T", payload: JSON.stringify(payload) })
      .execute();
    const row = await db
      .selectFrom("card_templates")
      .selectAll()
      .where("board_id", "=", board.id)
      .executeTakeFirstOrThrow();
    expect(row.payload).toEqual(payload);
  });

  it("deleting the board cascades the template away", async () => {
    const { board } = await seedTree();
    await db
      .insertInto("card_templates")
      .values({ board_id: board.id, name: "T", payload: JSON.stringify({}) })
      .execute();
    await db.deleteFrom("boards").where("id", "=", board.id).execute();
    const rows = await db.selectFrom("card_templates").selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it("down drops the table", async () => {
    await down(db);
    await expect(
      sql`select * from ${sql.table("card_templates")}`.execute(db),
    ).rejects.toThrow();
  });
});
