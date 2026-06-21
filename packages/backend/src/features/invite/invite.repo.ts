import type { Kysely } from "kysely";
import type { Database } from "../../db/types.js";
import type { InviteScopeValue } from "shared";

export type Db = Kysely<Database>;

export interface UpsertInviteInput {
  email: string;
  scope: InviteScopeValue;
  scopeId: string;
  permission: string;
  invitedBy: string;
}

// Idempotent per (email, scope, scope_id): re-inviting updates the permission
// and re-stamps who invited.
export async function upsert(db: Db, input: UpsertInviteInput): Promise<void> {
  await db
    .insertInto("invites")
    .values({
      email: input.email,
      scope: input.scope,
      scope_id: input.scopeId,
      permission: input.permission,
      invited_by: input.invitedBy,
    })
    .onConflict((oc) =>
      oc.columns(["email", "scope", "scope_id"]).doUpdateSet({
        permission: input.permission,
        invited_by: input.invitedBy,
      }),
    )
    .execute();
}

export function listForScope(db: Db, scope: InviteScopeValue, scopeId: string) {
  return db
    .selectFrom("invites")
    .leftJoin("users", "users.id", "invites.invited_by")
    .select([
      "invites.id as id",
      "invites.email as email",
      "invites.permission as permission",
      "users.email as invited_by_email",
      "invites.created_at as created_at",
    ])
    .where("invites.scope", "=", scope)
    .where("invites.scope_id", "=", scopeId)
    .orderBy("invites.created_at", "desc")
    .execute();
}

export function listForEmail(db: Db, email: string) {
  return db
    .selectFrom("invites")
    .select(["id", "scope", "scope_id", "permission"])
    .where("email", "=", email)
    .execute();
}

export function findById(db: Db, id: string) {
  return db
    .selectFrom("invites")
    .select(["id", "scope", "scope_id"])
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function deleteById(db: Db, id: string): Promise<void> {
  await db.deleteFrom("invites").where("id", "=", id).execute();
}
