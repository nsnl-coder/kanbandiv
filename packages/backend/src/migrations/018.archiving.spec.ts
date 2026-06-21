import crypto from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/types.js";
import { up as up001 } from "./001.auth.js";
import { up as up002 } from "./002.rbac.js";
import { up as up003 } from "./003.project.js";
import { up as up004 } from "./004.board.js";
import { up as up005 } from "./005.column.js";
import { up as up006 } from "./006.card.js";
import { up as up007 } from "./007.backup.js";
import { up as up008 } from "./008.backup-folder.js";
import { up as up009 } from "./009.label.js";
import { up as up010 } from "./010.card-due-date.js";
import { up as up011 } from "./011.checklist.js";
import { up as up012 } from "./012.comment.js";
import { up as up013 } from "./013.attachment.js";
import { up as up014 } from "./014.assignee.js";
import { up as up015 } from "./015.card-cover.js";
import { up as up016 } from "./016.activity.js";
import { up as up017 } from "./017.card-search.js";
import { down, up } from "./018.archiving.js";

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

describe("018 archiving migration", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = freshDb();
    await up001(db);
    await up002(db);
    await up003(db);
    await up004(db);
    await up005(db);
    await up006(db);
    await up007(db);
    await up008(db);
    await up009(db);
    await up010(db);
    await up011(db);
    await up012(db);
    await up013(db);
    await up014(db);
    await up015(db);
    await up016(db);
    await up017(db);
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
    return { board, column, card };
  }

  it("up runs (partial indexes boot under pg-mem) and does not throw", async () => {
    await expect(up(db)).resolves.not.toThrow();
  });

  it("archived_at is selectable and defaults to null on all three tables", async () => {
    await up(db);
    const { board, column, card } = await seedTree();
    const b = await db
      .selectFrom("boards")
      .select("archived_at")
      .where("id", "=", board.id)
      .executeTakeFirstOrThrow();
    const col = await db
      .selectFrom("columns")
      .select("archived_at")
      .where("id", "=", column.id)
      .executeTakeFirstOrThrow();
    const c = await db
      .selectFrom("cards")
      .select("archived_at")
      .where("id", "=", card.id)
      .executeTakeFirstOrThrow();
    expect(b.archived_at).toBeNull();
    expect(col.archived_at).toBeNull();
    expect(c.archived_at).toBeNull();
  });

  it("down drops archived_at from all three tables", async () => {
    await up(db);
    await down(db);
    await expect(
      sql`select archived_at from ${sql.table("boards")}`.execute(db),
    ).rejects.toThrow();
    await expect(
      sql`select archived_at from ${sql.table("columns")}`.execute(db),
    ).rejects.toThrow();
    await expect(
      sql`select archived_at from ${sql.table("cards")}`.execute(db),
    ).rejects.toThrow();
  });
});
