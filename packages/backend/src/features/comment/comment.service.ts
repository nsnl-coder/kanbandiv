import { TRPCError } from "@trpc/server";
import {
  ActivityType,
  type Comment,
  CommentError,
  type CommentThread,
  type CreateCommentInput,
  parseMentions,
  type UpdateCommentInput,
} from "shared";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import { cardTitle, record } from "../activity/activity.recorder.js";
import type { EmailPort } from "../email/email.service.js";
import { env } from "../../config/env.config.js";
import * as repo from "./comment.repo.js";
import type { Db } from "./comment.repo.js";

type CommentRow = {
  id: string;
  card_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  created_at: Date;
  updated_at: Date;
};

type CardRow = { id: string; column_id: string };
type ColumnRow = { id: string; board_id: string };

function commentNotFound() {
  return new TRPCError({
    code: "NOT_FOUND",
    message: CommentError.COMMENT_NOT_FOUND,
  });
}

function cardNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: CommentError.CARD_NOT_FOUND });
}

// Derive a display name from an email local-part.
function nameFromEmail(email: string): string {
  return email.split("@")[0];
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
  const card = (await repo.findCardById(db, cardId)) as CardRow | undefined;
  if (!card) throw cardNotFound();
  const column = (await repo.findColumnById(db, card.column_id)) as
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

async function buildComments(
  db: Db,
  rows: CommentRow[],
): Promise<Comment[]> {
  const ids = rows.map((r) => r.id);
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const authors = authorIds.length
    ? await db
        .selectFrom("users")
        .select(["id", "email"])
        .where("id", "in", authorIds)
        .execute()
    : [];
  const authorById = new Map(authors.map((a) => [a.id, a.email]));

  const mentionRows = (await repo.listMentionsForComments(db, ids)) as {
    comment_id: string;
    user_id: string;
    email: string;
  }[];
  const mentionsByComment = new Map<string, { id: string; name: string }[]>();
  for (const m of mentionRows) {
    const arr = mentionsByComment.get(m.comment_id) ?? [];
    arr.push({ id: m.user_id, name: nameFromEmail(m.email) });
    mentionsByComment.set(m.comment_id, arr);
  }

  return rows.map((r) => {
    const email = authorById.get(r.author_id) ?? "";
    return {
      id: r.id,
      cardId: r.card_id,
      authorId: r.author_id,
      parentId: r.parent_id,
      body: r.body,
      author: { id: r.author_id, name: nameFromEmail(email) },
      mentions: mentionsByComment.get(r.id) ?? [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export async function listComments(
  db: Db,
  user: CtxUser,
  cardId: string,
): Promise<CommentThread[]> {
  await resolveCardBoard(db, user, cardId, "view");
  const rows = (await repo.listByCard(db, cardId)) as CommentRow[];
  const comments = await buildComments(db, rows);
  const threads: CommentThread[] = [];
  const repliesByParent = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.parentId) {
      const arr = repliesByParent.get(c.parentId) ?? [];
      arr.push(c);
      repliesByParent.set(c.parentId, arr);
    }
  }
  for (const c of comments) {
    if (!c.parentId) {
      threads.push({ ...c, replies: repliesByParent.get(c.id) ?? [] });
    }
  }
  return threads;
}

export async function createComment(
  db: Db,
  user: CtxUser,
  email: EmailPort,
  input: CreateCommentInput,
): Promise<Comment> {
  const { boardId } = await resolveCardBoard(db, user, input.cardId, "view");

  let parentId: string | null = null;
  if (input.parentId) {
    const parent = (await repo.findCommentById(db, input.parentId)) as
      | CommentRow
      | undefined;
    if (!parent || parent.card_id !== input.cardId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: CommentError.PARENT_NOT_FOUND,
      });
    }
    if (parent.parent_id !== null) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: CommentError.PARENT_NOT_TOP_LEVEL,
      });
    }
    parentId = parent.id;
  }

  const row = (await repo.createComment(db, {
    cardId: input.cardId,
    authorId: user.id,
    parentId,
    body: input.body,
  })) as CommentRow;

  await record(db, {
    boardId,
    cardId: input.cardId,
    actorId: user.id,
    type: ActivityType.COMMENT_ADDED,
    meta: { snippet: input.body.slice(0, 140), cardTitle: await cardTitle(db, input.cardId) },
  });

  // Resolve @mentions to board members only; never the author.
  const tokens = parseMentions(input.body);
  if (tokens.length) {
    const members = await repo.listBoardMembers(db, boardId);
    const wanted = new Set(tokens.map((t) => t.toLowerCase()));
    const matched = members.filter(
      (m) =>
        m.id !== user.id && wanted.has(nameFromEmail(m.email).toLowerCase()),
    );
    if (matched.length) {
      await repo.insertMentions(
        db,
        row.id,
        matched.map((m) => m.id),
      );
      const link = cardLink(boardId, input.cardId);
      const snippet = input.body.slice(0, 140);
      const card = await db
        .selectFrom("cards")
        .select(["title"])
        .where("id", "=", input.cardId)
        .executeTakeFirst();
      const title = card?.title ?? "card";
      for (const m of matched) {
        await email.sendCommentMention(m.email, title, snippet, link);
      }
    }
  }

  const [out] = await buildComments(db, [row]);
  return out;
}

export async function updateComment(
  db: Db,
  user: CtxUser,
  id: string,
  patch: UpdateCommentInput,
): Promise<Comment> {
  const row = (await repo.findCommentById(db, id)) as CommentRow | undefined;
  if (!row) throw commentNotFound();
  await resolveCardBoard(db, user, row.card_id, "view");
  if (row.author_id !== user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: CommentError.NOT_AUTHOR });
  }
  const updated = (await repo.updateComment(db, id, patch.body)) as
    | CommentRow
    | undefined;
  if (!updated) throw commentNotFound();
  const [out] = await buildComments(db, [updated]);
  return out;
}

export async function deleteComment(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<{ ok: true }> {
  const row = (await repo.findCommentById(db, id)) as CommentRow | undefined;
  if (!row) throw commentNotFound();
  const { perm } = await resolveCardBoard(db, user, row.card_id, "view");
  if (row.author_id !== user.id && perm !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: CommentError.FORBIDDEN });
  }
  await repo.deleteComment(db, id);
  return { ok: true };
}
