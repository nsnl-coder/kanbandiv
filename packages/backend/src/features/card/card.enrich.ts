import type { Card, Label } from "shared";
import * as labelRepo from "../label/label.repo.js";
import * as checklistRepo from "../checklist/checklist.repo.js";
import * as commentRepo from "../comment/comment.repo.js";
import * as attachmentRepo from "../attachment/attachment.repo.js";
import * as assigneeRepo from "../assignee/assignee.repo.js";
import type { Db } from "./card.repo.js";

export type CardRow = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  position: number;
  due_at: Date | null;
  reminder_minutes: number | null;
  created_at: Date;
  updated_at: Date;
};

function isOverdue(due: Date | null, now: Date): boolean {
  return due != null && due.getTime() < now.getTime();
}

// Build full Card payloads for many rows with batch queries (no N+1).
export async function enrichCards(
  db: Db,
  rows: CardRow[],
  now = new Date(),
): Promise<Card[]> {
  const ids = rows.map((r) => r.id);

  const labelRows = (await labelRepo.listLabelsForCards(db, ids)) as ({
    card_id: string;
  } & Label & { board_id: string; created_at: Date; updated_at: Date })[];
  const labelsByCard = new Map<string, Label[]>();
  for (const lr of labelRows as any[]) {
    const list = labelsByCard.get(lr.card_id) ?? [];
    list.push({
      id: lr.id,
      boardId: lr.board_id,
      name: lr.name,
      color: lr.color,
      createdAt: lr.created_at,
      updatedAt: lr.updated_at,
    });
    labelsByCard.set(lr.card_id, list);
  }

  const progress = await checklistRepo.progressForCards(db, ids);
  const counts = await commentRepo.countByCards(db, ids);
  const attCounts = await attachmentRepo.countByCards(db, ids);
  const assigneesByCard = await assigneeRepo.listForCards(db, ids);

  return rows.map((r) => ({
    id: r.id,
    columnId: r.column_id,
    title: r.title,
    description: r.description,
    position: r.position,
    dueAt: r.due_at,
    reminderMinutes: r.reminder_minutes,
    isOverdue: isOverdue(r.due_at, now),
    labels: labelsByCard.get(r.id) ?? [],
    assignees: assigneesByCard.get(r.id) ?? [],
    checklistProgress: progress.get(r.id) ?? { done: 0, total: 0 },
    commentCount: counts.get(r.id) ?? 0,
    attachmentCount: attCounts.get(r.id) ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function enrichCard(
  db: Db,
  row: CardRow,
  now = new Date(),
): Promise<Card> {
  const [card] = await enrichCards(db, [row], now);
  return card;
}
