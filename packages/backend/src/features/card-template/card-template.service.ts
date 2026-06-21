import { TRPCError } from "@trpc/server";
import {
  ActivityType,
  type Card,
  type CardTemplate,
  CardTemplateError,
  type CardTemplatePayload,
  type CreateCardTemplateInput,
  type InstantiateCardTemplateInput,
  type UpdateCardTemplateInput,
} from "shared";
import { record } from "../activity/activity.recorder.js";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import * as cardRepo from "../card/card.repo.js";
import { type CardRow, enrichCard } from "../card/card.enrich.js";
import * as checklistRepo from "../checklist/checklist.repo.js";
import * as labelRepo from "../label/label.repo.js";
import * as repo from "./card-template.repo.js";
import type { Db } from "./card-template.repo.js";

type CardTemplateRow = {
  id: string;
  board_id: string;
  name: string;
  payload: CardTemplatePayload;
  created_at: Date;
  updated_at: Date;
};

type ColumnRow = { id: string; board_id: string };

function templateNotFound() {
  return new TRPCError({
    code: "NOT_FOUND",
    message: CardTemplateError.TEMPLATE_NOT_FOUND,
  });
}

function boardNotFound() {
  return new TRPCError({
    code: "NOT_FOUND",
    message: CardTemplateError.BOARD_NOT_FOUND,
  });
}

function columnNotFound() {
  return new TRPCError({
    code: "NOT_FOUND",
    message: CardTemplateError.COLUMN_NOT_FOUND,
  });
}

function invalidTarget() {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: CardTemplateError.INVALID_TARGET,
  });
}

export function toCardTemplate(row: CardTemplateRow): CardTemplate {
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    payload: row.payload,
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

async function loadTemplateFor(
  db: Db,
  user: CtxUser,
  id: string,
  min: "view" | "edit",
): Promise<CardTemplateRow> {
  const row = (await repo.findById(db, id)) as CardTemplateRow | undefined;
  if (!row) throw templateNotFound();
  await enforceBoard(db, user, row.board_id, min, templateNotFound);
  return row;
}

export async function listTemplates(
  db: Db,
  user: CtxUser,
  boardId: string,
): Promise<CardTemplate[]> {
  await enforceBoard(db, user, boardId, "view", boardNotFound);
  const rows = (await repo.listByBoard(db, boardId)) as CardTemplateRow[];
  return rows.map(toCardTemplate);
}

export async function createTemplate(
  db: Db,
  user: CtxUser,
  input: CreateCardTemplateInput,
): Promise<CardTemplate> {
  await enforceBoard(db, user, input.boardId, "edit", boardNotFound);
  const row = await repo.create(db, {
    boardId: input.boardId,
    name: input.name,
    payload: input.payload,
  });
  return toCardTemplate(row as CardTemplateRow);
}

export async function updateTemplate(
  db: Db,
  user: CtxUser,
  id: string,
  patch: UpdateCardTemplateInput,
): Promise<CardTemplate> {
  await loadTemplateFor(db, user, id, "edit");
  const updated = await repo.update(db, id, patch);
  if (!updated) throw templateNotFound();
  return toCardTemplate(updated as CardTemplateRow);
}

export async function deleteTemplate(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<{ ok: true }> {
  await loadTemplateFor(db, user, id, "edit");
  await repo.deleteById(db, id);
  return { ok: true };
}

// Create a card from a template in ONE service call (sequential db.*; no
// transaction — matches the repo's best-effort posture). Card is created FIRST,
// then cover/labels/checklists applied, then CARD_CREATED recorded (the recorder
// also publishes the realtime event — no separate bus.publish).
export async function instantiate(
  db: Db,
  user: CtxUser,
  id: string,
  input: InstantiateCardTemplateInput,
): Promise<Card> {
  const template = await loadTemplateFor(db, user, id, "edit");

  const column = (await cardRepo.findColumnById(db, input.columnId)) as
    | ColumnRow
    | undefined;
  if (!column) throw columnNotFound();
  // A template fills only its OWN board's column (no archived-column guard:
  // cards.create has none either — parity, audit B6).
  if (column.board_id !== template.board_id) throw invalidTarget();

  const payload = template.payload;

  const max = await cardRepo.maxPosition(db, input.columnId);
  const row = (await cardRepo.createCard(db, {
    columnId: input.columnId,
    title: template.name,
    description: payload.description ?? null,
    position: max + 1,
  })) as CardRow;

  if (payload.coverColor != null) {
    await cardRepo.updateCard(db, row.id, { cover_color: payload.coverColor });
  }

  // Stale-label skip: only attach ids that still exist on THIS board (filters
  // deleted + cross-board ids; never throws).
  if (payload.labelIds.length > 0) {
    const boardLabels = (await labelRepo.listByBoard(db, template.board_id)) as {
      id: string;
    }[];
    const valid = new Set(boardLabels.map((l) => l.id));
    for (const lid of payload.labelIds) {
      if (valid.has(lid)) await labelRepo.attachLabel(db, row.id, lid);
    }
  }

  // Fresh card: positions are simply sequential 1..n per checklist and per item.
  for (let i = 0; i < payload.checklists.length; i++) {
    const cl = payload.checklists[i];
    const c = await checklistRepo.createChecklist(db, {
      cardId: row.id,
      title: cl.title,
      position: i + 1,
    });
    for (let j = 0; j < cl.items.length; j++) {
      await checklistRepo.createItem(db, {
        checklistId: c.id,
        text: cl.items[j],
        position: j + 1,
      });
    }
  }

  await record(db, {
    boardId: template.board_id,
    cardId: row.id,
    actorId: user.id,
    type: ActivityType.CARD_CREATED,
    meta: { cardTitle: row.title },
  });

  // ALWAYS re-fetch: enrichCard reads cover_color off the row object, and the
  // create row predates the cover updateCard (audit B4).
  const fresh = (await cardRepo.findCardById(db, row.id)) as CardRow;
  return enrichCard(db, fresh);
}
