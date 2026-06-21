import type { Kysely } from "kysely";
import type { BoardViewConfig } from "shared";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export function getForUser(db: Db, userId: string, boardId: string) {
  return db
    .selectFrom("board_views")
    .selectAll()
    .where("user_id", "=", userId)
    .where("board_id", "=", boardId)
    .executeTakeFirst();
}

// INSERT ... ON CONFLICT upsert. config MUST be JSON.stringify'd on BOTH paths
// (jsonb: node-pg sends a raw object as "[object Object]" and corrupts the row).
export function upsert(
  db: Db,
  userId: string,
  boardId: string,
  mode: string,
  config: BoardViewConfig,
) {
  return db
    .insertInto("board_views")
    .values({
      user_id: userId,
      board_id: boardId,
      mode,
      config: JSON.stringify(config),
      updated_at: new Date(),
    })
    .onConflict((oc) =>
      oc.columns(["user_id", "board_id"]).doUpdateSet({
        mode,
        config: JSON.stringify(config),
        updated_at: new Date(),
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}
