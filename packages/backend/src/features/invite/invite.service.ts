import { TRPCError } from "@trpc/server";
import {
  InviteError,
  InviteScope,
  type InviteScopeValue,
  type PendingInvite,
  type ProjectPermission,
} from "shared";
import { env } from "../../config/env.config.js";
import type { EmailPort } from "../email/email.service.js";
import * as boardRepo from "../board/board.repo.js";
import * as projectRepo from "../project/project.repo.js";
import * as repo from "./invite.repo.js";
import type { Db } from "./invite.repo.js";

export interface CtxUser {
  id: string;
  isSuperuser: boolean;
}

function handleFromEmail(email: string): string {
  return email.split("@")[0];
}

function inviteLink(): string {
  return `${env.APP_BASE_URL}/register`;
}

async function ownerIdForScope(
  db: Db,
  scope: InviteScopeValue,
  scopeId: string,
): Promise<string | undefined> {
  const table = scope === InviteScope.Board ? "boards" : "projects";
  const row = await db
    .selectFrom(table)
    .select("owner_id")
    .where("id", "=", scopeId)
    .executeTakeFirst();
  return row?.owner_id;
}

async function ensureOwnsScope(
  db: Db,
  user: CtxUser,
  scope: InviteScopeValue,
  scopeId: string,
): Promise<void> {
  if (user.isSuperuser) return;
  const ownerId = await ownerIdForScope(db, scope, scopeId);
  if (ownerId !== user.id) {
    throw new TRPCError({ code: "NOT_FOUND", message: InviteError.NOT_FOUND });
  }
}

// Record (or refresh) a pending invite for an email with no account yet and send
// the invite mail. Called from the board/project grant path when the email does
// not resolve to a registered user.
export async function createOrUpdateInvite(
  db: Db,
  email: EmailPort,
  params: {
    inviteeEmail: string;
    scope: InviteScopeValue;
    scopeId: string;
    permission: string;
    invitedBy: string;
    scopeLabel: string;
  },
): Promise<void> {
  await repo.upsert(db, {
    email: params.inviteeEmail,
    scope: params.scope,
    scopeId: params.scopeId,
    permission: params.permission,
    invitedBy: params.invitedBy,
  });
  const inviter = await db
    .selectFrom("users")
    .select("email")
    .where("id", "=", params.invitedBy)
    .executeTakeFirst();
  await email.sendInvite(
    params.inviteeEmail,
    inviter ? handleFromEmail(inviter.email) : "Someone",
    params.scopeLabel,
    inviteLink(),
  );
}

export async function listForScope(
  db: Db,
  user: CtxUser,
  scope: InviteScopeValue,
  scopeId: string,
): Promise<PendingInvite[]> {
  await ensureOwnsScope(db, user, scope, scopeId);
  const rows = await repo.listForScope(db, scope, scopeId);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    permission: r.permission as PendingInvite["permission"],
    invitedByEmail: r.invited_by_email ?? null,
    createdAt: r.created_at,
  }));
}

export async function revoke(db: Db, user: CtxUser, id: string): Promise<void> {
  const invite = await repo.findById(db, id);
  if (!invite) {
    throw new TRPCError({ code: "NOT_FOUND", message: InviteError.NOT_FOUND });
  }
  await ensureOwnsScope(
    db,
    user,
    invite.scope as InviteScopeValue,
    invite.scope_id,
  );
  await repo.deleteById(db, id);
}

// On signup+verify: turn every pending invite for this email into a real access
// grant, then delete it. Best-effort per invite - a vanished scope (deleted
// board/project) just drops the invite. NEVER throws (must not fail signup).
export async function consumeForEmail(
  db: Db,
  userId: string,
  email: string,
): Promise<void> {
  const invites = await repo.listForEmail(db, email);
  for (const inv of invites) {
    try {
      const permission = inv.permission as ProjectPermission;
      if (inv.scope === InviteScope.Board) {
        const board = await boardRepo.findBoardById(db, inv.scope_id);
        if (board) {
          await boardRepo.upsertBoardAccess(db, inv.scope_id, userId, permission);
        }
      } else {
        const project = await projectRepo.findProjectById(db, inv.scope_id);
        if (project) {
          await projectRepo.upsertAccess(db, inv.scope_id, userId, permission);
        }
      }
      await repo.deleteById(db, inv.id);
    } catch {
      // leave the invite in place for a later retry; do not break signup
    }
  }
}
