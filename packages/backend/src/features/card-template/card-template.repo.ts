import type { Kysely } from "kysely";
import type { CardTemplatePayload } from "shared";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export function create(
  db: Db,
  input: { boardId: string; name: string; payload: CardTemplatePayload },
) {
  return db
    .insertInto("card_templates")
    .values({
      board_id: input.boardId,
      name: input.name,
      // jsonb: stringify on write (node-pg corruption guard, activity audit B1).
      payload: JSON.stringify(input.payload),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findById(db: Db, id: string) {
  return db
    .selectFrom("card_templates")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export function listByBoard(db: Db, boardId: string) {
  return db
    .selectFrom("card_templates")
    .selectAll()
    .where("board_id", "=", boardId)
    .orderBy("created_at", "asc")
    .execute();
}

export function update(
  db: Db,
  id: string,
  patch: { name?: string; payload?: CardTemplatePayload },
) {
  const set: { name?: string; payload?: string; updated_at: Date } = {
    updated_at: new Date(),
  };
  if (patch.name !== undefined) set.name = patch.name;
  // jsonb: stringify on the UPDATE path too (same corruption risk).
  if (patch.payload !== undefined) set.payload = JSON.stringify(patch.payload);
  return db
    .updateTable("card_templates")
    .set(set)
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function deleteById(db: Db, id: string) {
  return db.deleteFrom("card_templates").where("id", "=", id).execute();
}
