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
    .where("archived_at", "is", null)
    .orderBy("position", "asc")
    .execute();
}

export function listArchivedByBoard(db: Db, boardId: string) {
  return db
    .selectFrom("cards")
    .innerJoin("columns", "columns.id", "cards.column_id")
    .select([
      "cards.id as id",
      "cards.title as title",
      "cards.column_id as column_id",
      "columns.name as column_name",
      "cards.archived_at as archived_at",
    ])
    .where("columns.board_id", "=", boardId)
    .where("cards.archived_at", "is not", null)
    .orderBy("cards.position", "asc")
    .execute();
}

export function setCardArchived(db: Db, id: string, at: Date | null) {
  return db
    .updateTable("cards")
    .set({ archived_at: at, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function updateCard(
  db: Db,
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    due_at?: Date | null;
    reminder_minutes?: number | null;
    reminder_sent_at?: Date | null;
    cover_color?: string | null;
    cover_attachment_id?: string | null;
  },
) {
  return db
    .updateTable("cards")
    .set({ ...patch, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function listDueCards(db: Db, boardId: string, from: Date, to: Date) {
  return db
    .selectFrom("cards")
    .innerJoin("columns", "columns.id", "cards.column_id")
    .innerJoin("boards", "boards.id", "columns.board_id")
    .selectAll("cards")
    .where("columns.board_id", "=", boardId)
    // due_at >= from already excludes nulls; an explicit IS NOT NULL with a
    // range on the same column trips a pg-mem planner bug, so omit it.
    .where("cards.due_at", ">=", from)
    .where("cards.due_at", "<=", to)
    .where("cards.archived_at", "is", null)
    .where("columns.archived_at", "is", null)
    .where("boards.archived_at", "is", null)
    .orderBy("cards.due_at", "asc")
    .execute();
}

// Cards whose reminder is due now and not yet sent (worker scan).
export function findDueForReminder(db: Db, now: Date) {
  return db
    .selectFrom("cards")
    .innerJoin("columns", "columns.id", "cards.column_id")
    .innerJoin("boards", "boards.id", "columns.board_id")
    .selectAll("cards")
    // due_at >= now already excludes nulls (see listDueCards note).
    .where("cards.reminder_minutes", "is not", null)
    .where("cards.reminder_sent_at", "is", null)
    .where("cards.due_at", ">=", now)
    .where("cards.archived_at", "is", null)
    .where("columns.archived_at", "is", null)
    .where("boards.archived_at", "is", null)
    .execute();
}

export function stampReminderSent(db: Db, id: string, at: Date) {
  return db
    .updateTable("cards")
    .set({ reminder_sent_at: at })
    .where("id", "=", id)
    .execute();
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
    .where("archived_at", "is", null)
    .executeTakeFirst();
  return row?.m ?? 0;
}
