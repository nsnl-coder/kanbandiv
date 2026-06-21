import type { Kysely } from "kysely";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export function listByCard(db: Db, cardId: string) {
  return db
    .selectFrom("activities")
    .selectAll()
    .where("card_id", "=", cardId)
    .orderBy("created_at", "desc")
    .execute();
}

export function listByBoard(db: Db, boardId: string, limit: number, offset: number) {
  return db
    .selectFrom("activities")
    .selectAll()
    .where("board_id", "=", boardId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset)
    .execute();
}
