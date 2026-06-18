import { TRPCError } from "@trpc/server";
import {
  BoardError,
  type Card,
  type CreateCardInput,
  type MoveCardInput,
  type UpdateCardInput,
} from "shared";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import { computePosition } from "../column/column.service.js";
import * as repo from "./card.repo.js";
import type { Db } from "./card.repo.js";

type CardRow = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  position: number;
  created_at: Date;
  updated_at: Date;
};

type ColumnRow = {
  id: string;
  board_id: string;
};

function cardNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: BoardError.CARD_NOT_FOUND });
}

function columnNotFound() {
  return new TRPCError({
    code: "NOT_FOUND",
    message: BoardError.COLUMN_NOT_FOUND,
  });
}

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    columnId: row.column_id,
    title: row.title,
    description: row.description,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function enforceBoard(
  db: Db,
  user: CtxUser,
  boardId: string,
  min: "view" | "edit",
  notFound: () => TRPCError,
): Promise<void> {
  try {
    await loadBoardFor(db, user, boardId, min);
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") throw notFound();
    throw err;
  }
}

// Load a card with its parent column, enforcing board permission.
async function loadCardFor(
  db: Db,
  user: CtxUser,
  id: string,
  min: "view" | "edit",
): Promise<{ card: CardRow; column: ColumnRow }> {
  const card = (await repo.findCardById(db, id)) as CardRow | undefined;
  if (!card) throw cardNotFound();
  const column = (await repo.findColumnById(db, card.column_id)) as
    | ColumnRow
    | undefined;
  if (!column) throw cardNotFound();
  await enforceBoard(db, user, column.board_id, min, cardNotFound);
  return { card, column };
}

export async function createCard(
  db: Db,
  user: CtxUser,
  input: CreateCardInput,
): Promise<Card> {
  const column = (await repo.findColumnById(db, input.columnId)) as
    | ColumnRow
    | undefined;
  if (!column) throw columnNotFound();
  await enforceBoard(db, user, column.board_id, "edit", columnNotFound);
  const max = await repo.maxPosition(db, input.columnId);
  const row = await repo.createCard(db, {
    columnId: input.columnId,
    title: input.title,
    description: input.description ?? null,
    position: max + 1,
  });
  return toCard(row as CardRow);
}

export async function updateCard(
  db: Db,
  user: CtxUser,
  id: string,
  patch: UpdateCardInput,
): Promise<Card> {
  await loadCardFor(db, user, id, "edit");
  const updated = await repo.updateCard(db, id, patch);
  if (!updated) throw cardNotFound();
  return toCard(updated as CardRow);
}

export async function deleteCard(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<{ ok: true }> {
  await loadCardFor(db, user, id, "edit");
  await repo.deleteCard(db, id);
  return { ok: true };
}

export async function moveCard(
  db: Db,
  user: CtxUser,
  id: string,
  input: MoveCardInput,
): Promise<Card> {
  const { column } = await loadCardFor(db, user, id, "edit");
  const target = (await repo.findColumnById(db, input.toColumnId)) as
    | ColumnRow
    | undefined;
  if (!target) throw columnNotFound();
  // The target column must belong to the same board as the card.
  if (target.board_id !== column.board_id) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: BoardError.INVALID_MOVE,
    });
  }
  const siblings = (await repo.listByColumn(db, input.toColumnId)) as CardRow[];
  const position = computePosition(
    siblings.filter((s) => s.id !== id),
    input.beforeId,
    input.afterId,
  );
  const updated = await repo.setPosition(db, id, input.toColumnId, position);
  if (!updated) throw cardNotFound();
  return toCard(updated as CardRow);
}
