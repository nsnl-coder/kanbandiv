import type { SearchCardsInput, SearchPage, SearchResult } from "shared";
import * as repo from "./search.repo.js";
import type { Db } from "./search.repo.js";

export interface CtxUser {
  id: string;
  isSuperuser: boolean;
}

const SNIPPET_LEN = 140;

function isOverdue(due: Date | null, now: Date): boolean {
  return due != null && due.getTime() < now.getTime();
}

function plainSnippet(description: string | null, title: string): string {
  const src = (description ?? title ?? "").trim();
  return src.length > SNIPPET_LEN ? src.slice(0, SNIPPET_LEN) : src;
}

export async function searchCards(
  db: Db,
  user: CtxUser,
  input: SearchCardsInput,
): Promise<SearchPage> {
  const q = input.q.trim();
  const hasText = q.length > 0;
  const hasFilter = !!(
    input.labelIds?.length ||
    input.assigneeIds?.length ||
    input.due ||
    input.projectId ||
    input.boardId
  );

  // No text and no filter: a global "match everything" scan is wasteful; skip DB.
  if (!hasText && !hasFilter) return { items: [], nextOffset: null };

  const now = new Date();
  const rows = (await repo.searchCards(db, {
    userId: user.id,
    isSuperuser: user.isSuperuser,
    q,
    hasText,
    labelIds: input.labelIds,
    assigneeIds: input.assigneeIds,
    due: input.due,
    projectId: input.projectId,
    boardId: input.boardId,
    now,
    limit: input.limit,
    offset: input.offset,
  })) as Array<{
    id: string;
    title: string;
    description: string | null;
    due_at: Date | null;
    column_id: string;
    column_name: string;
    board_id: string;
    board_name: string;
    project_id: string;
    snippet?: string;
  }>;

  const items: SearchResult[] = rows.map((r) => ({
    cardId: r.id,
    title: r.title,
    snippet: hasText
      ? (r.snippet ?? "").replace(repo.SNIPPET_SEL_RE, "")
      : plainSnippet(r.description, r.title),
    boardId: r.board_id,
    boardName: r.board_name,
    columnId: r.column_id,
    columnName: r.column_name,
    projectId: r.project_id,
    dueAt: r.due_at,
    isOverdue: isOverdue(r.due_at, now),
  }));

  const nextOffset =
    items.length === input.limit ? input.offset + items.length : null;
  return { items, nextOffset };
}
