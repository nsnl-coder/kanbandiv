import type { Kysely } from "kysely";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export function createCard(
  db: Db,
  input: {
    columnId: string;
    title: string;
    description: string | null;
    position: number;
  },
) {
  return db
    .insertInto("cards")
    .values({
      column_id: input.columnId,
      title: input.title,
      description: input.description,
      position: input.position,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findCardById(db: Db, id: string) {
  return db
    .selectFrom("cards")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export function findColumnById(db: Db, id: string) {
  return db
    .selectFrom("columns")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export function listByColumn(db: Db, columnId: string) {
  return db
    .selectFrom("cards")
    .selectAll()
    .where("column_id", "=", columnId)
    .orderBy("position", "asc")
    .execute();
}

export function updateCard(
  db: Db,
  id: string,
  patch: { title?: string; description?: string | null },
) {
  return db
    .updateTable("cards")
    .set({ ...patch, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function setPosition(
  db: Db,
  id: string,
  columnId: string,
  position: number,
) {
  return db
    .updateTable("cards")
    .set({ column_id: columnId, position, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function deleteCard(db: Db, id: string) {
  return db.deleteFrom("cards").where("id", "=", id).execute();
}

export async function maxPosition(db: Db, columnId: string): Promise<number> {
  const row = await db
    .selectFrom("cards")
    .select((eb) => eb.fn.max("position").as("m"))
    .where("column_id", "=", columnId)
    .executeTakeFirst();
  return row?.m ?? 0;
}
