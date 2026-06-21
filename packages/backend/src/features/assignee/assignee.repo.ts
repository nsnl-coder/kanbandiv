import type { Kysely } from "kysely";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export function findByCardUser(db: Db, cardId: string, userId: string) {
  return db
    .selectFrom("card_assignees")
    .selectAll()
    .where("card_id", "=", cardId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
}

export async function assign(db: Db, cardId: string, userId: string): Promise<void> {
  await db
    .insertInto("card_assignees")
    .values({ card_id: cardId, user_id: userId })
    .onConflict((oc) => oc.columns(["card_id", "user_id"]).doNothing())
    .execute();
}

export async function unassign(db: Db, cardId: string, userId: string): Promise<void> {
  await db
    .deleteFrom("card_assignees")
    .where("card_id", "=", cardId)
    .where("user_id", "=", userId)
    .execute();
}

export function listByCard(db: Db, cardId: string) {
  return db
    .selectFrom("card_assignees")
    .innerJoin("users", "users.id", "card_assignees.user_id")
    .select(["users.id as id", "users.email as email"])
    .where("card_assignees.card_id", "=", cardId)
    .orderBy("users.email", "asc")
    .execute();
}

// Batch assignees for a set of cards, for board getData (no N+1).
export async function listForCards(
  db: Db,
  cardIds: string[],
): Promise<Map<string, { id: string; email: string }[]>> {
  const out = new Map<string, { id: string; email: string }[]>();
  if (cardIds.length === 0) return out;
  const rows = await db
    .selectFrom("card_assignees")
    .innerJoin("users", "users.id", "card_assignees.user_id")
    .select([
      "card_assignees.card_id as card_id",
      "users.id as id",
      "users.email as email",
    ])
    .where("card_assignees.card_id", "in", cardIds)
    .orderBy("users.email", "asc")
    .execute();
  for (const r of rows) {
    const list = out.get(r.card_id) ?? [];
    list.push({ id: r.id, email: r.email });
    out.set(r.card_id, list);
  }
  return out;
}

// Hard-delete every assignment for a user on all cards under a board.
export async function unassignAllForBoard(
  db: Db,
  boardId: string,
  userId: string,
): Promise<void> {
  await db
    .deleteFrom("card_assignees")
    .where("user_id", "=", userId)
    .where("card_id", "in", (eb) =>
      eb
        .selectFrom("cards")
        .innerJoin("columns", "columns.id", "cards.column_id")
        .select("cards.id")
        .where("columns.board_id", "=", boardId),
    )
    .execute();
}
