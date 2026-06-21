import { TRPCError } from "@trpc/server";
import {
  type Activity,
  type ActivityMeta,
  ActivityError,
  type BoardActivityPage,
  type ListBoardActivityInput,
  type ListCardActivityInput,
} from "shared";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import * as commentRepo from "../comment/comment.repo.js";
import * as repo from "./activity.repo.js";
import type { Db } from "./activity.repo.js";

type ActivityRow = {
  id: string;
  board_id: string;
  card_id: string | null;
  actor_id: string | null;
  type: string;
  meta: ActivityMeta;
  created_at: Date;
};

type CardRow = { id: string; column_id: string };
type ColumnRow = { id: string; board_id: string };

function cardNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: ActivityError.CARD_NOT_FOUND });
}

function boardNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: ActivityError.BOARD_NOT_FOUND });
}

// Derive a display name from an email local-part (copied from comment.service:
// the helper there is file-local; copying avoids cross-feature coupling).
function nameFromEmail(email: string): string {
  return email.split("@")[0];
}

async function resolveCardBoard(
  db: Db,
  user: CtxUser,
  cardId: string,
  min: "view" | "edit" | "owner",
): Promise<{ boardId: string }> {
  const card = (await commentRepo.findCardById(db, cardId)) as CardRow | undefined;
  if (!card) throw cardNotFound();
  const column = (await commentRepo.findColumnById(db, card.column_id)) as
    | ColumnRow
    | undefined;
  if (!column) throw cardNotFound();
  try {
    await loadBoardFor(db, user, column.board_id, min);
    return { boardId: column.board_id };
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") throw cardNotFound();
    throw err;
  }
}

async function buildActivities(db: Db, rows: ActivityRow[]): Promise<Activity[]> {
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => id !== null))];
  const actors = actorIds.length
    ? await db
        .selectFrom("users")
        .select(["id", "email"])
        .where("id", "in", actorIds)
        .execute()
    : [];
  const emailById = new Map(actors.map((a) => [a.id, a.email]));

  return rows.map((r) => {
    const email = r.actor_id ? emailById.get(r.actor_id) : undefined;
    return {
      id: r.id,
      boardId: r.board_id,
      cardId: r.card_id,
      type: r.type,
      meta: r.meta,
      actor: { id: r.actor_id, handle: email ? nameFromEmail(email) : "unknown" },
      createdAt: r.created_at,
    };
  });
}

export async function listCardActivity(
  db: Db,
  user: CtxUser,
  { cardId }: ListCardActivityInput,
): Promise<Activity[]> {
  await resolveCardBoard(db, user, cardId, "view");
  const rows = (await repo.listByCard(db, cardId)) as ActivityRow[];
  return buildActivities(db, rows);
}

export async function listBoardActivity(
  db: Db,
  user: CtxUser,
  { boardId, limit, offset }: ListBoardActivityInput,
): Promise<BoardActivityPage> {
  try {
    await loadBoardFor(db, user, boardId, "view");
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") throw boardNotFound();
    throw err;
  }
  const rows = (await repo.listByBoard(db, boardId, limit, offset)) as ActivityRow[];
  const items = await buildActivities(db, rows);
  const nextOffset = items.length === limit ? offset + items.length : null;
  return { items, nextOffset };
}
