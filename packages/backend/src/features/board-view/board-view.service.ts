import { TRPCError } from "@trpc/server";
import {
  type BoardView,
  BoardViewError,
  boardViewSchema,
  defaultBoardView,
  type GetBoardViewInput,
  type SetBoardViewInput,
} from "shared";
import { LogEvent } from "../../config/const.config.js";
import { logger } from "../../logger.js";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import * as repo from "./board-view.repo.js";
import type { Db } from "./board-view.repo.js";

function boardNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: BoardViewError.BOARD_NOT_FOUND });
}

async function requireBoardView(db: Db, user: CtxUser, boardId: string): Promise<void> {
  try {
    await loadBoardFor(db, user, boardId, "view");
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") throw boardNotFound();
    throw err;
  }
}

export async function getBoardView(
  db: Db,
  user: CtxUser,
  { boardId }: GetBoardViewInput,
): Promise<BoardView> {
  await requireBoardView(db, user, boardId);
  const row = await repo.getForUser(db, user.id, boardId);
  if (!row) return defaultBoardView;
  // Defensive re-parse: mode is plain text (not DB-enum), config may be stale or
  // hand-edited. A corrupt preference must NOT 500 the board — fall back.
  const parsed = boardViewSchema.safeParse({ mode: row.mode, config: row.config });
  if (parsed.success) return parsed.data;
  logger.warn(
    { event: LogEvent.BoardViewParseFailed, userId: user.id, boardId },
    LogEvent.BoardViewParseFailed,
  );
  return defaultBoardView;
}

export async function setBoardView(
  db: Db,
  user: CtxUser,
  input: SetBoardViewInput,
): Promise<BoardView> {
  await requireBoardView(db, user, input.boardId);
  const saved = await repo.upsert(db, user.id, input.boardId, input.mode, input.config);
  return boardViewSchema.parse({ mode: saved.mode, config: saved.config });
}
