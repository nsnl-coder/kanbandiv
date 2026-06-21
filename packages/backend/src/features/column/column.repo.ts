import type { Kysely } from "kysely";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export function createColumn(
  db: Db,
  input: { boardId: string; name: string; position: number },
) {
  return db
    .insertInto("columns")
    .values({
      board_id: input.boardId,
      name: input.name,
      position: input.position,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findColumnById(db: Db, id: string) {
  return db
    .selectFrom("columns")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export function listByBoard(db: Db, boardId: string) {
  return db
    .selectFrom("columns")
    .selectAll()
    .where("board_id", "=", boardId)
    .where("archived_at", "is", null)
    .orderBy("position", "asc")
    .execute();
}

export function listArchivedByBoard(db: Db, boardId: string) {
  return db
    .selectFrom("columns")
    .selectAll()
    .where("board_id", "=", boardId)
    .where("archived_at", "is not", null)
    .orderBy("position", "asc")
    .execute();
}

export function setColumnArchived(db: Db, id: string, at: Date | null) {
  return db
    .updateTable("columns")
    .set({ archived_at: at, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function updateColumn(db: Db, id: string, patch: { name?: string }) {
  return db
    .updateTable("columns")
    .set({ ...patch, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function setPosition(db: Db, id: string, position: number) {
  return db
    .updateTable("columns")
    .set({ position, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function deleteColumn(db: Db, id: string) {
  return db.deleteFrom("columns").where("id", "=", id).execute();
}

export async function maxPosition(db: Db, boardId: string): Promise<number> {
  const row = await db
    .selectFrom("columns")
    .select((eb) => eb.fn.max("position").as("m"))
    .where("board_id", "=", boardId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  return row?.m ?? 0;
}
