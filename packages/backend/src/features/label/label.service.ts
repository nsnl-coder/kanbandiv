import { TRPCError } from "@trpc/server";
import {
  ActivityType,
  type CardLabelInput,
  type CreateLabelInput,
  type Label,
  LabelError,
  type UpdateLabelInput,
} from "shared";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import { cardTitle, record } from "../activity/activity.recorder.js";
import * as repo from "./label.repo.js";
import type { Db } from "./label.repo.js";

type LabelRow = {
  id: string;
  board_id: string;
  name: string;
  color: string;
  created_at: Date;
  updated_at: Date;
};

type CardRow = { id: string; column_id: string };
type ColumnRow = { id: string; board_id: string };

function labelNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: LabelError.LABEL_NOT_FOUND });
}

function cardNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: LabelError.CARD_NOT_FOUND });
}

function boardNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: LabelError.BOARD_NOT_FOUND });
}

export function toLabel(row: LabelRow): Label {
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    color: row.color,
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

async function loadLabelFor(
  db: Db,
  user: CtxUser,
  id: string,
  min: "view" | "edit",
): Promise<LabelRow> {
  const row = (await repo.findLabelById(db, id)) as LabelRow | undefined;
  if (!row) throw labelNotFound();
  await enforceBoard(db, user, row.board_id, min, labelNotFound);
  return row;
}

// Resolve the board owning a card via the card -> column chain.
async function loadCardBoard(
  db: Db,
  user: CtxUser,
  cardId: string,
  min: "view" | "edit",
): Promise<{ card: CardRow; boardId: string }> {
  const card = (await repo.findCardById(db, cardId)) as CardRow | undefined;
  if (!card) throw cardNotFound();
  const column = (await repo.findColumnById(db, card.column_id)) as
    | ColumnRow
    | undefined;
  if (!column) throw cardNotFound();
  await enforceBoard(db, user, column.board_id, min, cardNotFound);
  return { card, boardId: column.board_id };
}

export async function listLabels(
  db: Db,
  user: CtxUser,
  boardId: string,
): Promise<Label[]> {
  await enforceBoard(db, user, boardId, "view", boardNotFound);
  const rows = (await repo.listByBoard(db, boardId)) as LabelRow[];
  return rows.map(toLabel);
}

export async function createLabel(
  db: Db,
  user: CtxUser,
  input: CreateLabelInput,
): Promise<Label> {
  await enforceBoard(db, user, input.boardId, "edit", boardNotFound);
  const row = await repo.createLabel(db, {
    boardId: input.boardId,
    name: input.name,
    color: input.color,
  });
  return toLabel(row as LabelRow);
}

export async function updateLabel(
  db: Db,
  user: CtxUser,
  id: string,
  patch: UpdateLabelInput,
): Promise<Label> {
  await loadLabelFor(db, user, id, "edit");
  const updated = await repo.updateLabel(db, id, patch);
  if (!updated) throw labelNotFound();
  return toLabel(updated as LabelRow);
}

export async function deleteLabel(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<{ ok: true }> {
  await loadLabelFor(db, user, id, "edit");
  await repo.deleteLabel(db, id);
  return { ok: true };
}

export async function attachLabel(
  db: Db,
  user: CtxUser,
  input: CardLabelInput,
): Promise<Label[]> {
  const { boardId } = await loadCardBoard(db, user, input.cardId, "edit");
  const label = (await repo.findLabelById(db, input.labelId)) as
    | LabelRow
    | undefined;
  if (!label) throw labelNotFound();
  if (label.board_id !== boardId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: LabelError.LABEL_BOARD_MISMATCH,
    });
  }
  await repo.attachLabel(db, input.cardId, input.labelId);
  await record(db, {
    boardId,
    cardId: input.cardId,
    actorId: user.id,
    type: ActivityType.LABEL_ATTACHED,
    meta: {
      labelName: label.name,
      labelColor: label.color,
      cardTitle: await cardTitle(db, input.cardId),
    },
  });
  return cardLabels(db, input.cardId);
}

export async function detachLabel(
  db: Db,
  user: CtxUser,
  input: CardLabelInput,
): Promise<Label[]> {
  const { boardId } = await loadCardBoard(db, user, input.cardId, "edit");
  const label = (await repo.findLabelById(db, input.labelId)) as
    | LabelRow
    | undefined;
  await repo.detachLabel(db, input.cardId, input.labelId);
  if (label) {
    await record(db, {
      boardId,
      cardId: input.cardId,
      actorId: user.id,
      type: ActivityType.LABEL_DETACHED,
      meta: {
        labelName: label.name,
        labelColor: label.color,
        cardTitle: await cardTitle(db, input.cardId),
      },
    });
  }
  return cardLabels(db, input.cardId);
}

async function cardLabels(db: Db, cardId: string): Promise<Label[]> {
  const rows = (await repo.listLabelsForCard(db, cardId)) as LabelRow[];
  return rows.map(toLabel);
}
