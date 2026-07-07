import type { Kysely } from "kysely";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export function createDemoUser(
  db: Db,
  input: { email: string; passwordHash: string },
) {
  return db
    .insertInto("users")
    .values({
      email: input.email,
      password_hash: input.passwordHash,
      // Pre-verified: there is no inbox to verify against, and authedProcedure
      // rejects unverified accounts.
      email_verified: true,
      is_demo: true,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Delete demo users created before the cutoff. Every row a demo user owns
 * (projects -> boards -> columns -> cards -> labels/checklists/comments/...,
 * plus refresh tokens and access grants) hangs off users.id via ON DELETE
 * CASCADE, so a single delete sweeps the whole account. auth_events.user_id
 * has no FK on purpose (audit rows outlive accounts).
 */
export async function deleteDemoUsersCreatedBefore(
  db: Db,
  cutoff: Date,
): Promise<number> {
  const res = await db
    .deleteFrom("users")
    .where("is_demo", "=", true)
    .where("created_at", "<", cutoff)
    .executeTakeFirst();
  return Number(res.numDeletedRows);
}
