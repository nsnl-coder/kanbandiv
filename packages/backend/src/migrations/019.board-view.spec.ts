import crypto from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/types.js";
import { up as up001 } from "./001.auth.js";
import { up as up003 } from "./003.project.js";
import { up as up004 } from "./004.board.js";
import { down, up } from "./019.board-view.js";

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

describe("019 board-view migration", () => {
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

  it("up creates board_views; jsonb config round-trips via JSON.stringify", async () => {
    const { user, board } = await seedTree();
    const config = { labelIds: ["L1"], assigneeIds: [], assignedToMe: false, due: "overdue", swimlaneBy: null };
    await db
      .insertInto("board_views")
      .values({
        user_id: user.id,
        board_id: board.id,
        mode: "table",
        config: JSON.stringify(config),
        updated_at: new Date(),
      })
      .execute();
    const row = await db
      .selectFrom("board_views")
      .selectAll()
      .where("user_id", "=", user.id)
      .where("board_id", "=", board.id)
      .executeTakeFirstOrThrow();
    expect(row.mode).toBe("table");
    expect(row.config).toEqual(config);
  });

  it("composite PK rejects a duplicate (user_id, board_id) plain insert", async () => {
    const { user, board } = await seedTree();
    const values = {
      user_id: user.id,
      board_id: board.id,
      mode: "kanban",
      config: JSON.stringify({}),
      updated_at: new Date(),
    };
    await db.insertInto("board_views").values(values).execute();
    await expect(db.insertInto("board_views").values(values).execute()).rejects.toThrow();
  });

  it("deleting the user cascades the row away", async () => {
    const { user, board } = await seedTree();
    await db
      .insertInto("board_views")
      .values({ user_id: user.id, board_id: board.id, mode: "kanban", config: JSON.stringify({}), updated_at: new Date() })
      .execute();
    await db.deleteFrom("users").where("id", "=", user.id).execute();
    const rows = await db.selectFrom("board_views").selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it("deleting the board cascades the row away", async () => {
    const { user, board } = await seedTree();
    await db
      .insertInto("board_views")
      .values({ user_id: user.id, board_id: board.id, mode: "kanban", config: JSON.stringify({}), updated_at: new Date() })
      .execute();
    await db.deleteFrom("boards").where("id", "=", board.id).execute();
    const rows = await db.selectFrom("board_views").selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it("down drops the table", async () => {
    await down(db);
    await expect(
      sql`select * from ${sql.table("board_views")}`.execute(db),
    ).rejects.toThrow();
  });
});
