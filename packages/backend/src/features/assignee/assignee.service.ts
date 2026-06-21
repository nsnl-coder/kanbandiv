import { TRPCError } from "@trpc/server";
import {
  type Assignee,
  AssigneeError,
  type AssignInput,
  type ListAssigneesInput,
  type ListBoardMembersInput,
  type UnassignInput,
} from "shared";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import * as commentRepo from "../comment/comment.repo.js";
import type { EmailPort } from "../email/email.service.js";
import { env } from "../../config/env.config.js";
import * as repo from "./assignee.repo.js";
import type { Db } from "./assignee.repo.js";

type CardRow = { id: string; column_id: string };
type ColumnRow = { id: string; board_id: string };

function cardNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: AssigneeError.CARD_NOT_FOUND });
}

function boardNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: AssigneeError.BOARD_NOT_FOUND });
}

function cardLink(boardId: string, cardId: string): string {
  return `${env.APP_BASE_URL}/boards/${boardId}?card=${cardId}`;
}

async function resolveCardBoard(
  db: Db,
  user: CtxUser,
  cardId: string,
  min: "view" | "edit" | "owner",
): Promise<{ boardId: string; perm: "view" | "edit" | "owner" }> {
  const card = (await commentRepo.findCardById(db, cardId)) as CardRow | undefined;
  if (!card) throw cardNotFound();
  const column = (await commentRepo.findColumnById(db, card.column_id)) as
    | ColumnRow
    | undefined;
  if (!column) throw cardNotFound();
  try {
    const { perm } = await loadBoardFor(db, user, column.board_id, min);
    return { boardId: column.board_id, perm };
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") throw cardNotFound();
    throw err;
  }
}

export async function listAssignees(
  db: Db,
  user: CtxUser,
  { cardId }: ListAssigneesInput,
): Promise<Assignee[]> {
  await resolveCardBoard(db, user, cardId, "view");
  const rows = await repo.listByCard(db, cardId);
  return rows.map((r) => ({ id: r.id, email: r.email }));
}

export async function listBoardMembers(
  db: Db,
  user: CtxUser,
  { boardId }: ListBoardMembersInput,
): Promise<Assignee[]> {
  try {
    await loadBoardFor(db, user, boardId, "view");
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") throw boardNotFound();
    throw err;
  }
  const members = await commentRepo.listBoardMembers(db, boardId);
  return members.map((m) => ({ id: m.id, email: m.email }));
}

export async function assign(
  db: Db,
  user: CtxUser,
  email: EmailPort,
  { cardId, userId }: AssignInput,
): Promise<Assignee[]> {
  const { boardId } = await resolveCardBoard(db, user, cardId, "edit");

  const members = await commentRepo.listBoardMembers(db, boardId);
  const target = members.find((m) => m.id === userId);
  if (!target) {
    const exists = await db
      .selectFrom("users")
      .select("id")
      .where("id", "=", userId)
      .executeTakeFirst();
    throw new TRPCError({
      code: "NOT_FOUND",
      message: exists ? AssigneeError.NOT_BOARD_MEMBER : AssigneeError.USER_NOT_FOUND,
    });
  }

  const existing = await repo.findByCardUser(db, cardId, userId);
  if (!existing) {
    await repo.assign(db, cardId, userId);
    if (target.id !== user.id) {
      const card = await db
        .selectFrom("cards")
        .select(["title"])
        .where("id", "=", cardId)
        .executeTakeFirst();
      const title = card?.title ?? "card";
      await email.sendCardAssigned(target.email, title, cardLink(boardId, cardId));
    }
  }

  const rows = await repo.listByCard(db, cardId);
  return rows.map((r) => ({ id: r.id, email: r.email }));
}

export async function unassign(
  db: Db,
  user: CtxUser,
  { cardId, userId }: UnassignInput,
): Promise<Assignee[]> {
  await resolveCardBoard(db, user, cardId, "edit");
  await repo.unassign(db, cardId, userId);
  const rows = await repo.listByCard(db, cardId);
  return rows.map((r) => ({ id: r.id, email: r.email }));
}
