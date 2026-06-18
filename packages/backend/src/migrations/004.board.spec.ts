import crypto from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/types.js";
import { up as up001 } from "./001.auth.js";
import { up as up003 } from "./003.project.js";
import { down, up } from "./004.board.js";
import { up as up005 } from "./005.column.js";
import { up as up006 } from "./006.card.js";

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

describe("004/005/006 board migrations", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = freshDb();
    await up001(db);
    await up003(db);
    await up(db);
    await up005(db);
    await up006(db);
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
      .values({
        project_id: project.id,
        owner_id: user.id,
        name: "B",
        color: "#000000",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("board_access")
      .values({ board_id: board.id, user_id: user.id, permission: "edit" })
      .execute();
    const column = await db
      .insertInto("columns")
      .values({ board_id: board.id, name: "C", position: 1 })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("cards")
      .values({ column_id: column.id, title: "T", position: 1 })
      .execute();
    return { project, board, column };
  }

  const count = async (
    table: "boards" | "board_access" | "columns" | "cards",
  ) => {
    const row = await db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .executeTakeFirstOrThrow();
    return Number(row.c);
  };

  it("deleting a project cascades boards, columns, cards and access", async () => {
    const { project } = await seedTree();
    expect(await count("boards")).toBe(1);
    expect(await count("board_access")).toBe(1);
    expect(await count("columns")).toBe(1);
    expect(await count("cards")).toBe(1);

    await db.deleteFrom("projects").where("id", "=", project.id).execute();

    expect(await count("boards")).toBe(0);
    expect(await count("board_access")).toBe(0);
    expect(await count("columns")).toBe(0);
    expect(await count("cards")).toBe(0);
  });

  it("deleting a board cascades its columns, cards and access", async () => {
    const { board } = await seedTree();
    await db.deleteFrom("boards").where("id", "=", board.id).execute();
    expect(await count("board_access")).toBe(0);
    expect(await count("columns")).toBe(0);
    expect(await count("cards")).toBe(0);
  });

  it("down drops board and board_access tables", async () => {
    // Drop children first so the board down migration can run.
    await db.schema.dropTable("cards").ifExists().execute();
    await db.schema.dropTable("columns").ifExists().execute();
    await down(db);
    for (const table of ["boards", "board_access"]) {
      await expect(
        sql`select 1 from ${sql.table(table)}`.execute(db),
      ).rejects.toThrow();
    }
  });
});
