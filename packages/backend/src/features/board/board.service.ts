import { TRPCError } from "@trpc/server";
import {
  ActivityType,
  BoardEventType,
  type ArchivedBoardItems,
  type Board,
  type BoardAccessEntry,
  type BoardData,
  BoardError,
  type CreateBoardInput,
  type GrantBoardAccessInput,
  InviteScope,
  type MyPermission,
  ProjectVisibility,
  type RevokeBoardAccessInput,
  type UpdateBoardInput,
} from "shared";
import { type CardRow, enrichCards } from "../card/card.enrich.js";
import * as assigneeRepo from "../assignee/assignee.repo.js";
import * as cardRepo from "../card/card.repo.js";
import * as columnRepo from "../column/column.repo.js";
import { record } from "../activity/activity.recorder.js";
import { bus } from "../realtime/realtime.bus.js";
import type { EmailPort } from "../email/email.service.js";
import * as invite from "../invite/invite.service.js";
import * as repo from "./board.repo.js";
import type { Db } from "./board.repo.js";

export interface CtxUser {
  id: string;
  isSuperuser: boolean;
}

export type BoardRow = {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  color: string;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type ProjectRow = {
  id: string;
  owner_id: string;
  visibility: ProjectVisibility;
};

function boardNotFound() {
  return new TRPCError({
    code: "NOT_FOUND",
    message: BoardError.BOARD_NOT_FOUND,
  });
}

function forbidden() {
  return new TRPCError({ code: "FORBIDDEN", message: BoardError.FORBIDDEN });
}

function nameFromEmail(email: string): string {
  return email.split("@")[0];
}

const RANK: Record<MyPermission, number> = { view: 0, edit: 1, owner: 2 };

// Effective board permission: max(inherited project permission, board grant).
export async function resolveBoardPermission(
  db: Db,
  board: BoardRow,
  user: CtxUser,
): Promise<MyPermission | null> {
  if (user.isSuperuser) return "owner";
  const project = (await repo.findProjectById(db, board.project_id)) as
    | ProjectRow
    | undefined;
  if (project && project.owner_id === user.id) return "owner";
  if (board.owner_id === user.id) return "owner";

  const grant = await repo.findBoardAccess(db, board.id, user.id);

  let inherited: MyPermission | null = null;
  if (project) {
    const projectGrant = await repo.findProjectAccess(db, project.id, user.id);
    if (projectGrant) inherited = projectGrant;
    else if (project.visibility === ProjectVisibility.Public) inherited = "view";
  }

  if (grant && inherited) return RANK[grant] >= RANK[inherited] ? grant : inherited;
  return grant ?? inherited;
}

function toBoard(row: BoardRow, myPermission: MyPermission): Board {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    color: row.color,
    myPermission,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Load a board and the caller's effective permission, or NOT_FOUND when the
// caller has no access (private boards must not leak their existence).
export async function loadBoardFor(
  db: Db,
  user: CtxUser,
  id: string,
  min: MyPermission,
): Promise<{ row: BoardRow; perm: MyPermission }> {
  const row = await repo.findBoardById(db, id);
  if (!row) throw boardNotFound();
  const perm = await resolveBoardPermission(db, row as BoardRow, user);
  if (!perm) throw boardNotFound();
  if (RANK[perm] < RANK[min]) {
    if (min === "view") throw boardNotFound();
    throw forbidden();
  }
  return { row: row as BoardRow, perm };
}

export async function getBoard(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<Board> {
  const { row, perm } = await loadBoardFor(db, user, id, "view");
  if (row.archived_at != null) throw boardNotFound();
  return toBoard(row, perm);
}

export async function listBoards(
  db: Db,
  user: CtxUser,
  projectId: string,
): Promise<Board[]> {
  const rows = (await repo.listBoardsForProject(db, projectId)) as BoardRow[];
  const out: Board[] = [];
  for (const row of rows) {
    const perm = await resolveBoardPermission(db, row, user);
    if (perm) out.push(toBoard(row, perm));
  }
  return out;
}

export async function getBoardData(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<BoardData> {
  const { row, perm } = await loadBoardFor(db, user, id, "view");
  if (row.archived_at != null) throw boardNotFound();
  const columns = await repo.listColumnsForBoard(db, id);
  const cards = await repo.listCardsForBoard(db, id);
  const enriched = await enrichCards(db, cards as CardRow[]);
  const byColumn = new Map<string, BoardData["columns"][number]["cards"]>();
  for (const col of columns) byColumn.set(col.id, []);
  for (const c of enriched) {
    byColumn.get(c.columnId)?.push(c);
  }
  return {
    ...toBoard(row, perm),
    columns: columns.map((col) => ({
      id: col.id,
      boardId: col.board_id,
      name: col.name,
      position: col.position,
      archivedAt: col.archived_at,
      createdAt: col.created_at,
      updatedAt: col.updated_at,
      cards: byColumn.get(col.id) ?? [],
    })),
  };
}

export async function createBoard(
  db: Db,
  user: CtxUser,
  input: CreateBoardInput,
): Promise<Board> {
  const project = (await repo.findProjectById(db, input.projectId)) as
    | ProjectRow
    | undefined;
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: BoardError.PROJECT_NOT_FOUND,
    });
  }
  const projectPerm = await resolveProjectPermission(db, project, user);
  if (!projectPerm) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: BoardError.PROJECT_NOT_FOUND,
    });
  }
  if (RANK[projectPerm] < RANK.edit) throw forbidden();
  const row = await repo.createBoard(db, {
    projectId: input.projectId,
    ownerId: user.id,
    name: input.name,
    description: input.description ?? null,
    color: input.color,
  });
  return toBoard(row as BoardRow, "owner");
}

async function resolveProjectPermission(
  db: Db,
  project: ProjectRow,
  user: CtxUser,
): Promise<MyPermission | null> {
  if (user.isSuperuser) return "owner";
  if (project.owner_id === user.id) return "owner";
  const grant = await repo.findProjectAccess(db, project.id, user.id);
  if (grant) return grant;
  if (project.visibility === ProjectVisibility.Public) return "view";
  return null;
}

export async function updateBoard(
  db: Db,
  user: CtxUser,
  id: string,
  patch: UpdateBoardInput,
): Promise<Board> {
  const { perm } = await loadBoardFor(db, user, id, "edit");
  const updated = await repo.updateBoard(db, id, patch);
  if (!updated) throw boardNotFound();
  bus.publish({ boardId: id, actorId: user.id, ts: Date.now(), type: BoardEventType.BOARD_CHANGED });
  return toBoard(updated as BoardRow, perm);
}

export async function deleteBoard(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<{ ok: true }> {
  await loadBoardFor(db, user, id, "owner");
  await repo.deleteBoard(db, id);
  bus.publish({ boardId: id, actorId: user.id, ts: Date.now(), type: BoardEventType.BOARD_CHANGED });
  return { ok: true };
}

export async function archiveBoard(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<Board> {
  const { row, perm } = await loadBoardFor(db, user, id, "owner");
  if (row.archived_at != null) return toBoard(row, perm); // idempotent no-op
  const updated = (await repo.setBoardArchived(db, id, new Date())) as
    | BoardRow
    | undefined;
  if (!updated) throw boardNotFound();
  await record(db, {
    boardId: id,
    cardId: null,
    actorId: user.id,
    type: ActivityType.BOARD_ARCHIVED,
    meta: { boardName: row.name },
  });
  return toBoard(updated, perm);
}

export async function restoreBoard(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<Board> {
  const { row, perm } = await loadBoardFor(db, user, id, "owner");
  if (row.archived_at == null) return toBoard(row, perm); // idempotent no-op
  const updated = (await repo.setBoardArchived(db, id, null)) as
    | BoardRow
    | undefined;
  if (!updated) throw boardNotFound();
  await record(db, {
    boardId: id,
    cardId: null,
    actorId: user.id,
    type: ActivityType.BOARD_RESTORED,
    meta: { boardName: row.name },
  });
  return toBoard(updated, perm);
}

export async function listArchivedBoards(
  db: Db,
  user: CtxUser,
  projectId: string,
): Promise<Board[]> {
  const rows = (await repo.listArchivedBoardsForProject(
    db,
    projectId,
  )) as BoardRow[];
  const out: Board[] = [];
  for (const row of rows) {
    const perm = await resolveBoardPermission(db, row, user);
    if (perm) out.push(toBoard(row, perm));
  }
  return out;
}

export async function getArchivedItems(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<ArchivedBoardItems> {
  await loadBoardFor(db, user, id, "edit");
  const columns = await columnRepo.listArchivedByBoard(db, id);
  const cards = await cardRepo.listArchivedByBoard(db, id);
  return {
    columns: columns.map((c) => ({
      id: c.id,
      boardId: c.board_id,
      name: c.name,
      position: c.position,
      archivedAt: c.archived_at,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
    cards: cards.map((c) => ({
      id: c.id,
      title: c.title,
      columnId: c.column_id,
      columnName: c.column_name,
      archivedAt: c.archived_at,
    })),
  };
}

export async function listBoardAccess(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<BoardAccessEntry[]> {
  await loadBoardFor(db, user, id, "owner");
  const rows = await repo.listBoardAccess(db, id);
  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    permission: r.permission,
  }));
}

export async function grantBoardAccess(
  db: Db,
  user: CtxUser,
  id: string,
  input: GrantBoardAccessInput,
  email: EmailPort,
): Promise<BoardAccessEntry[]> {
  const { row } = await loadBoardFor(db, user, id, "owner");
  const target = await repo.findUserByEmail(db, input.email);
  if (!target) {
    // No account yet: record a pending invite + email instead of erroring. It
    // becomes a real grant when this address signs up and verifies.
    await invite.createOrUpdateInvite(db, email, {
      inviteeEmail: input.email,
      scope: InviteScope.Board,
      scopeId: id,
      permission: input.permission,
      invitedBy: user.id,
      scopeLabel: row.name,
    });
    return listBoardAccess(db, user, id);
  }
  if (target.id === row.owner_id) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: BoardError.CANNOT_GRANT_OWNER,
    });
  }
  if (target.id === user.id) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: BoardError.CANNOT_GRANT_SELF,
    });
  }
  await repo.upsertBoardAccess(db, id, target.id, input.permission);
  await record(db, {
    boardId: id,
    cardId: null,
    actorId: user.id,
    type: ActivityType.MEMBER_GRANTED,
    meta: {
      targetEmail: target.email,
      targetHandle: nameFromEmail(target.email),
      permission: input.permission,
    },
  });
  return listBoardAccess(db, user, id);
}

export async function revokeBoardAccess(
  db: Db,
  user: CtxUser,
  id: string,
  input: RevokeBoardAccessInput,
): Promise<BoardAccessEntry[]> {
  await loadBoardFor(db, user, id, "owner");
  const u = await db
    .selectFrom("users")
    .select(["email"])
    .where("id", "=", input.userId)
    .executeTakeFirst();
  await repo.deleteBoardAccess(db, id, input.userId);
  await assigneeRepo.unassignAllForBoard(db, id, input.userId);
  if (u) {
    await record(db, {
      boardId: id,
      cardId: null,
      actorId: user.id,
      type: ActivityType.MEMBER_REVOKED,
      meta: { targetEmail: u.email, targetHandle: nameFromEmail(u.email) },
    });
  }
  return listBoardAccess(db, user, id);
}
