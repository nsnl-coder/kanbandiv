import { TRPCError } from "@trpc/server";
import {
  type ListNotificationsInput,
  type MarkAllResult,
  type MarkReadInput,
  type Notification,
  NotificationError,
  type NotificationPage,
  type NotificationPayload,
  type UnreadCount,
} from "shared";
import type { CtxUser } from "../board/board.service.js";
import * as repo from "./notification.repo.js";
import type { Db } from "./notification.repo.js";

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  payload: NotificationPayload;
  read_at: Date | null;
  created_at: Date;
};

export async function list(
  db: Db,
  user: CtxUser,
  { limit, offset }: ListNotificationsInput,
): Promise<NotificationPage> {
  const rows = (await repo.listByUser(db, user.id, limit, offset)) as NotificationRow[];
  const items: Notification[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: r.payload,
    readAt: r.read_at,
    createdAt: r.created_at,
  }));
  const nextOffset = items.length === limit ? offset + items.length : null;
  return { items, nextOffset };
}

export async function unreadCount(db: Db, user: CtxUser): Promise<UnreadCount> {
  return { count: await repo.countUnread(db, user.id) };
}

export async function markRead(
  db: Db,
  user: CtxUser,
  { id }: MarkReadInput,
): Promise<{ ok: true }> {
  const row = await repo.existsForUser(db, user.id, id);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: NotificationError.NOT_FOUND });
  }
  await repo.markRead(db, user.id, id);
  return { ok: true };
}

export async function markAllRead(db: Db, user: CtxUser): Promise<MarkAllResult> {
  return { updated: await repo.markAllRead(db, user.id) };
}
