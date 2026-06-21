import { type Kysely, sql } from "kysely";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export function listByUser(db: Db, userId: string, limit: number, offset: number) {
  return db
    .selectFrom("notifications")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset)
    .execute();
}

export async function countUnread(db: Db, userId: string): Promise<number> {
  const row = await db
    .selectFrom("notifications")
    .where("user_id", "=", userId)
    .where("read_at", "is", null)
    .select((eb) => eb.fn.countAll().as("count"))
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function markRead(db: Db, userId: string, id: string): Promise<number> {
  const res = await db
    .updateTable("notifications")
    .set({ read_at: sql`now()` })
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .where("read_at", "is", null)
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

export async function markAllRead(db: Db, userId: string): Promise<number> {
  const res = await db
    .updateTable("notifications")
    .set({ read_at: sql`now()` })
    .where("user_id", "=", userId)
    .where("read_at", "is", null)
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

export function existsForUser(db: Db, userId: string, id: string) {
  return db
    .selectFrom("notifications")
    .select("id")
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();
}

// --- delivery preferences (absent row = both channels on) ---

export function listPrefs(db: Db, userId: string) {
  return db
    .selectFrom("notification_prefs")
    .select(["type", "in_app", "email"])
    .where("user_id", "=", userId)
    .execute();
}

export function getPref(db: Db, userId: string, type: string) {
  return db
    .selectFrom("notification_prefs")
    .select(["in_app", "email"])
    .where("user_id", "=", userId)
    .where("type", "=", type)
    .executeTakeFirst();
}

export async function upsertPref(
  db: Db,
  userId: string,
  type: string,
  values: { in_app: boolean; email: boolean },
): Promise<void> {
  await db
    .insertInto("notification_prefs")
    .values({ user_id: userId, type, in_app: values.in_app, email: values.email })
    .onConflict((oc) =>
      oc.columns(["user_id", "type"]).doUpdateSet({
        in_app: values.in_app,
        email: values.email,
      }),
    )
    .execute();
}
