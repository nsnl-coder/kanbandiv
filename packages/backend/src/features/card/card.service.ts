import { TRPCError } from "@trpc/server";
import {
  ActivityType,
  BoardError,
  type Card,
  CardCoverError,
  COVER_IMAGE_MIME,
  type CreateCardInput,
  type ListDueCardsInput,
  type MoveCardInput,
  type UpdateCardInput,
} from "shared";
import { record } from "../activity/activity.recorder.js";
import * as attachmentRepo from "../attachment/attachment.repo.js";
import type { AttachmentRow } from "../attachment/attachment.repo.js";
import * as boardRepo from "../board/board.repo.js";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import { logger } from "../../logger.js";
import type { Storage } from "../attachment/attachment.storage.js";
import { computePosition } from "../column/column.service.js";
import { type CardRow, enrichCard, enrichCards } from "./card.enrich.js";
import * as repo from "./card.repo.js";
import type { Db } from "./card.repo.js";

type ColumnRow = {
  id: string;
  board_id: string;
  name: string;
  archived_at?: Date | null;
};

type BoardArchRow = { id: string; archived_at: Date | null };

function cardNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: BoardError.CARD_NOT_FOUND });
}

function columnNotFound() {
  return new TRPCError({
    code: "NOT_FOUND",
    message: BoardError.COLUMN_NOT_FOUND,
  });
}

function coverErr(code: CardCoverError, status: TRPCError["code"]): TRPCError {
  return new TRPCError({ code: status, message: code });
}

function invalidDueRange() {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: BoardError.INVALID_DUE_RANGE,
  });
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
  await record(db, {
    boardId: column.board_id,
    cardId: (row as CardRow).id,
    actorId: user.id,
    type: ActivityType.CARD_CREATED,
    meta: { cardTitle: (row as CardRow).title },
  });
  return enrichCard(db, row as CardRow);
}

export async function updateCard(
  db: Db,
  user: CtxUser,
  id: string,
  patch: UpdateCardInput,
): Promise<Card> {
  const { card: before, column } = await loadCardFor(db, user, id, "edit");
  const dbPatch: {
    title?: string;
    description?: string | null;
    due_at?: Date | null;
    reminder_minutes?: number | null;
    reminder_sent_at?: Date | null;
    cover_color?: string | null;
    cover_attachment_id?: string | null;
  } = {};
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.reminderMinutes !== undefined) {
    dbPatch.reminder_minutes = patch.reminderMinutes;
  }
  // Changing the due date resets a prior reminder so it can fire again.
  if (patch.dueAt !== undefined) {
    dbPatch.due_at = patch.dueAt;
    dbPatch.reminder_sent_at = null;
  }
  await applyCoverPatch(db, id, patch, dbPatch);
  const updated = (await repo.updateCard(db, id, dbPatch)) as CardRow | undefined;
  if (!updated) throw cardNotFound();
  await recordCardUpdate(db, user.id, column.board_id, before, updated, patch);
  return enrichCard(db, updated);
}

// Emit one activity row per changed field (a single updateCard can produce
// several: e.g. rename + due date).
async function recordCardUpdate(
  db: Db,
  actorId: string,
  boardId: string,
  before: CardRow,
  updated: CardRow,
  patch: UpdateCardInput,
): Promise<void> {
  const cardTitle = updated.title;
  if (before.title !== updated.title) {
    await record(db, {
      boardId,
      cardId: updated.id,
      actorId,
      type: ActivityType.CARD_RENAMED,
      meta: { from: before.title, to: updated.title, cardTitle },
    });
  }
  if (patch.description !== undefined && before.description !== updated.description) {
    await record(db, {
      boardId,
      cardId: updated.id,
      actorId,
      type: ActivityType.CARD_DESCRIPTION_CHANGED,
      meta: { cardTitle },
    });
  }
  if (patch.dueAt !== undefined) {
    await record(db, {
      boardId,
      cardId: updated.id,
      actorId,
      type: patch.dueAt ? ActivityType.DUE_DATE_SET : ActivityType.DUE_DATE_CLEARED,
      meta: patch.dueAt
        ? { dueAt: patch.dueAt.toISOString(), cardTitle }
        : { cardTitle },
    });
  }
  if (patch.coverColor !== undefined || patch.coverAttachmentId !== undefined) {
    const coverKind = updated.cover_attachment_id
      ? "image"
      : updated.cover_color
        ? "color"
        : "none";
    await record(db, {
      boardId,
      cardId: updated.id,
      actorId,
      type: ActivityType.COVER_CHANGED,
      meta: { coverKind, cardTitle },
    });
  }
}

// Map the cover tri-state fields onto dbPatch, enforcing mutual exclusion and
// validating an image cover against the SAME card's image attachments.
async function applyCoverPatch(
  db: Db,
  cardId: string,
  patch: UpdateCardInput,
  dbPatch: { cover_color?: string | null; cover_attachment_id?: string | null },
): Promise<void> {
  const hasColor = patch.coverColor != null;
  const hasImage = patch.coverAttachmentId != null;
  if (hasColor && hasImage) {
    throw coverErr(CardCoverError.COVER_CONFLICT, "BAD_REQUEST");
  }
  if (patch.coverColor !== undefined) {
    if (patch.coverColor != null) {
      dbPatch.cover_color = patch.coverColor;
      dbPatch.cover_attachment_id = null;
    } else {
      dbPatch.cover_color = null;
    }
  }
  if (patch.coverAttachmentId !== undefined) {
    if (patch.coverAttachmentId != null) {
      const att = (await attachmentRepo.findById(db, patch.coverAttachmentId)) as
        | AttachmentRow
        | undefined;
      if (!att || att.card_id !== cardId) {
        throw coverErr(CardCoverError.COVER_ATTACHMENT_NOT_FOUND, "NOT_FOUND");
      }
      if (!(COVER_IMAGE_MIME as readonly string[]).includes(att.mime_type)) {
        throw coverErr(CardCoverError.COVER_NOT_IMAGE, "BAD_REQUEST");
      }
      dbPatch.cover_attachment_id = patch.coverAttachmentId;
      dbPatch.cover_color = null;
    } else {
      dbPatch.cover_attachment_id = null;
    }
  }
}

export async function listDueCards(
  db: Db,
  user: CtxUser,
  input: ListDueCardsInput,
): Promise<Card[]> {
  if (input.from.getTime() > input.to.getTime()) throw invalidDueRange();
  await enforceBoard(db, user, input.boardId, "view", () =>
    new TRPCError({ code: "NOT_FOUND", message: BoardError.BOARD_NOT_FOUND }),
  );
  const rows = (await repo.listDueCards(
    db,
    input.boardId,
    input.from,
    input.to,
  )) as CardRow[];
  return enrichCards(db, rows);
}

export async function deleteCard(
  db: Db,
  storage: Storage,
  user: CtxUser,
  id: string,
): Promise<{ ok: true }> {
  const { card, column } = await loadCardFor(db, user, id, "edit");
  await repo.deleteCard(db, id);
  await record(db, {
    boardId: column.board_id,
    cardId: null,
    actorId: user.id,
    type: ActivityType.CARD_DELETED,
    meta: { cardTitle: card.title, cardId: id },
  });
  // DB cascade removes attachment rows; the MinIO objects are not cascaded.
  await storage
    .removePrefix(`cards/${id}/`)
    .catch((err) => logger.error({ err, cardId: id }, "attachment prefix cleanup failed"));
  return { ok: true };
}

export async function archiveCard(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<Card> {
  const { card, column } = await loadCardFor(db, user, id, "edit");
  if (card.archived_at != null) return enrichCard(db, card); // idempotent no-op
  const updated = (await repo.setCardArchived(db, id, new Date())) as
    | CardRow
    | undefined;
  if (!updated) throw cardNotFound();
  await record(db, {
    boardId: column.board_id,
    cardId: id,
    actorId: user.id,
    type: ActivityType.CARD_ARCHIVED,
    meta: { cardTitle: card.title },
  });
  return enrichCard(db, updated);
}

export async function restoreCard(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<Card> {
  const { card } = await loadCardFor(db, user, id, "edit");
  if (card.archived_at == null) return enrichCard(db, card); // idempotent no-op
  // Parent guards: UNFILTERED finders so archived parents are actually seen.
  const column = (await repo.findColumnById(db, card.column_id)) as
    | ColumnRow
    | undefined;
  if (!column) throw cardNotFound();
  const board = (await boardRepo.findBoardById(db, column.board_id)) as
    | BoardArchRow
    | undefined;
  if (column.archived_at != null || board?.archived_at != null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: BoardError.PARENT_ARCHIVED,
    });
  }
  const updated = (await repo.setCardArchived(db, id, null)) as
    | CardRow
    | undefined;
  if (!updated) throw cardNotFound();
  await record(db, {
    boardId: column.board_id,
    cardId: id,
    actorId: user.id,
    type: ActivityType.CARD_RESTORED,
    meta: { cardTitle: card.title },
  });
  return enrichCard(db, updated);
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
  const updated = (await repo.setPosition(db, id, input.toColumnId, position)) as
    | CardRow
    | undefined;
  if (!updated) throw cardNotFound();
  if (input.toColumnId !== column.id) {
    await record(db, {
      boardId: column.board_id,
      cardId: id,
      actorId: user.id,
      type: ActivityType.CARD_MOVED,
      meta: { fromColumn: column.name, toColumn: target.name, cardTitle: updated.title },
    });
  }
  return enrichCard(db, updated);
}
