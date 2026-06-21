import type { Kysely } from "kysely";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export type AttachmentRow = {
  id: string;
  card_id: string;
  uploader_id: string;
  filename: string;
  mime_type: string;
  size_bytes: string;
  storage_key: string;
  created_at: Date;
};

export function create(
  db: Db,
  row: {
    id: string;
    cardId: string;
    uploaderId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
  },
) {
  return db
    .insertInto("attachments")
    .values({
      id: row.id,
      card_id: row.cardId,
      uploader_id: row.uploaderId,
      filename: row.filename,
      mime_type: row.mimeType,
      size_bytes: row.sizeBytes,
      storage_key: row.storageKey,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findById(db: Db, id: string) {
  return db.selectFrom("attachments").selectAll().where("id", "=", id).executeTakeFirst();
}

export function listByCard(db: Db, cardId: string) {
  return db
    .selectFrom("attachments")
    .selectAll()
    .where("card_id", "=", cardId)
    .orderBy("created_at", "asc")
    .execute();
}

export function deleteById(db: Db, id: string) {
  return db.deleteFrom("attachments").where("id", "=", id).execute();
}

export async function listKeysByCard(db: Db, cardId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("attachments")
    .select("storage_key")
    .where("card_id", "=", cardId)
    .execute();
  return rows.map((r) => r.storage_key);
}

// Batch attachment counts for a set of cards, for board getData (no N+1).
export async function countByCards(db: Db, cardIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (cardIds.length === 0) return out;
  const rows = await db
    .selectFrom("attachments")
    .select((eb) => ["card_id", eb.fn.countAll<string>().as("c")])
    .where("card_id", "in", cardIds)
    .groupBy("card_id")
    .execute();
  for (const r of rows as { card_id: string; c: string }[]) {
    out.set(r.card_id, Number(r.c));
  }
  return out;
}
