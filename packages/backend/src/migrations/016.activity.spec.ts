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
import { down, up } from "./016.activity.js";

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

describe("016 activity migration", () => {
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
    const column = await db
      .insertInto("columns")
      .values({ board_id: board.id, name: "C", position: 1 })
      .returning("id")
      .executeTakeFirstOrThrow();
    const card = await db
      .insertInto("cards")
      .values({ column_id: column.id, title: "T", position: 1 })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { user, board, card };
  }

  async function insertActivity(boardId: string, cardId: string | null, actorId: string | null) {
    return db
      .insertInto("activities")
      .values({
        board_id: boardId,
        card_id: cardId,
        actor_id: actorId,
        type: "CARD_CREATED",
        meta: JSON.stringify({ cardTitle: "T" }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  it("up creates the activities table (insert + select works)", async () => {
    const { board, card, user } = await seedTree();
    const { id } = await insertActivity(board.id, card.id, user.id);
    const row = await db
      .selectFrom("activities")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.type).toBe("CARD_CREATED");
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it("jsonb meta round-trips to a parsed object", async () => {
    const { board, card, user } = await seedTree();
    const { id } = await insertActivity(board.id, card.id, user.id);
    const row = await db
      .selectFrom("activities")
      .select(["meta"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.meta).toEqual({ cardTitle: "T" });
  });

  it("deleting the card sets card_id NULL (row survives)", async () => {
    const { board, card, user } = await seedTree();
    const { id } = await insertActivity(board.id, card.id, user.id);
    await db.deleteFrom("cards").where("id", "=", card.id).execute();
    const row = await db
      .selectFrom("activities")
      .select(["card_id", "meta"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.card_id).toBeNull();
    expect(row.meta).toEqual({ cardTitle: "T" });
  });

  it("deleting the board cascades its activity rows", async () => {
    const { board, card, user } = await seedTree();
    await insertActivity(board.id, card.id, user.id);
    await db.deleteFrom("boards").where("id", "=", board.id).execute();
    const rows = await db
      .selectFrom("activities")
      .selectAll()
      .where("board_id", "=", board.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it("deleting the actor sets actor_id NULL (row survives)", async () => {
    // A board owned by one user, but the activity's actor is a SECOND user, so
    // deleting the actor does not cascade-delete the board (and thus the row).
    const { board, card } = await seedTree();
    const actor = await db
      .insertInto("users")
      .values({ email: "actor@example.com", password_hash: "x" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const { id } = await insertActivity(board.id, card.id, actor.id);
    await db.deleteFrom("users").where("id", "=", actor.id).execute();
    const row = await db
      .selectFrom("activities")
      .select(["actor_id"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.actor_id).toBeNull();
  });

  it("down drops the table", async () => {
    await down(db);
    await expect(
      sql`select 1 from ${sql.table("activities")}`.execute(db),
    ).rejects.toThrow();
  });
});
