import { TRPCError } from "@trpc/server";
import {
  ActivityType,
  BoardError,
  type Column,
  type CreateColumnInput,
  type MoveColumnInput,
  type UpdateColumnInput,
} from "shared";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import { record } from "../activity/activity.recorder.js";
import * as boardRepo from "../board/board.repo.js";
import * as repo from "./column.repo.js";
import type { Db } from "./column.repo.js";

type BoardArchRow = { id: string; archived_at: Date | null };

type ColumnRow = {
  id: string;
  board_id: string;
  name: string;
  position: number;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function columnNotFound() {
  return new TRPCError({
    code: "NOT_FOUND",
    message: BoardError.COLUMN_NOT_FOUND,
  });
}

function toColumn(row: ColumnRow): Column {
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    position: row.position,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cards: [],
  };
}

// Load a column and enforce the caller's board permission. NOT_FOUND when the
// column does not exist or the board is not viewable (no existence leak).
async function loadColumnFor(
  db: Db,
  user: CtxUser,
  id: string,
  min: "view" | "edit",
): Promise<ColumnRow> {
  const row = (await repo.findColumnById(db, id)) as ColumnRow | undefined;
  if (!row) throw columnNotFound();
  try {
    await loadBoardFor(db, user, row.board_id, min);
  } catch (err) {
    // A board the caller cannot view must read as a missing column.
    if (err instanceof TRPCError && err.code === "NOT_FOUND") throw columnNotFound();
    throw err;
  }
  return row;
}

export async function createColumn(
  db: Db,
  user: CtxUser,
  input: CreateColumnInput,
): Promise<Column> {
  try {
    await loadBoardFor(db, user, input.boardId, "edit");
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: BoardError.BOARD_NOT_FOUND,
      });
    }
    throw err;
  }
  const max = await repo.maxPosition(db, input.boardId);
  const row = await repo.createColumn(db, {
    boardId: input.boardId,
    name: input.name,
    position: max + 1,
  });
  return toColumn(row as ColumnRow);
}

export async function updateColumn(
  db: Db,
  user: CtxUser,
  id: string,
  patch: UpdateColumnInput,
): Promise<Column> {
  await loadColumnFor(db, user, id, "edit");
  const updated = await repo.updateColumn(db, id, patch);
  if (!updated) throw columnNotFound();
  return toColumn(updated as ColumnRow);
}

export async function deleteColumn(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<{ ok: true }> {
  await loadColumnFor(db, user, id, "edit");
  await repo.deleteColumn(db, id);
  return { ok: true };
}

export async function archiveColumn(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<Column> {
  const row = await loadColumnFor(db, user, id, "edit");
  if (row.archived_at != null) return toColumn(row); // idempotent no-op
  const updated = (await repo.setColumnArchived(db, id, new Date())) as
    | ColumnRow
    | undefined;
  if (!updated) throw columnNotFound();
  await record(db, {
    boardId: row.board_id,
    cardId: null,
    actorId: user.id,
    type: ActivityType.COLUMN_ARCHIVED,
    meta: { columnName: row.name },
  });
  return toColumn(updated);
}

export async function restoreColumn(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<Column> {
  const row = await loadColumnFor(db, user, id, "edit");
  if (row.archived_at == null) return toColumn(row); // idempotent no-op
  // Parent guard: UNFILTERED finder so an archived board is actually seen.
  const board = (await boardRepo.findBoardById(db, row.board_id)) as
    | BoardArchRow
    | undefined;
  if (board?.archived_at != null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: BoardError.PARENT_ARCHIVED,
    });
  }
  const updated = (await repo.setColumnArchived(db, id, null)) as
    | ColumnRow
    | undefined;
  if (!updated) throw columnNotFound();
  await record(db, {
    boardId: row.board_id,
    cardId: null,
    actorId: user.id,
    type: ActivityType.COLUMN_RESTORED,
    meta: { columnName: row.name },
  });
  return toColumn(updated);
}

export async function moveColumn(
  db: Db,
  user: CtxUser,
  id: string,
  input: MoveColumnInput,
): Promise<Column> {
  const row = await loadColumnFor(db, user, id, "edit");
  const siblings = (await repo.listByBoard(db, row.board_id)) as ColumnRow[];
  const position = computePosition(
    siblings.filter((s) => s.id !== id),
    input.beforeId,
    input.afterId,
  );
  const updated = await repo.setPosition(db, id, position);
  if (!updated) throw columnNotFound();
  return toColumn(updated as ColumnRow);
}

// Compute a fractional position from optional before/after neighbour ids in an
// ordered sibling list. New = midpoint of neighbours; edges step by +/- 1.
export function computePosition(
  ordered: { id: string; position: number }[],
  beforeId: string | undefined,
  afterId: string | undefined,
): number {
  const prev = afterId ? ordered.find((s) => s.id === afterId) : undefined;
  const next = beforeId ? ordered.find((s) => s.id === beforeId) : undefined;
  if (prev && next) return (prev.position + next.position) / 2;
  if (prev) return prev.position + 1;
  if (next) return next.position - 1;
  // No neighbours: append to the end.
  const max = ordered.reduce((m, s) => Math.max(m, s.position), 0);
  return ordered.length ? max + 1 : 0;
}
