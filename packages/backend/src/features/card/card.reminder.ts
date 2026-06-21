import { NotificationType } from "shared";
import { env } from "../../config/env.config.js";
import type { EmailPort } from "../email/email.service.js";
import * as commentRepo from "../comment/comment.repo.js";
import {
  create as createNotification,
  shouldNotify,
} from "../notification/notification.recorder.js";
import { bus } from "../realtime/realtime.bus.js";
import * as repo from "./card.repo.js";
import type { Db } from "./card.repo.js";

type DueCardRow = {
  id: string;
  column_id: string;
  title: string;
  due_at: Date;
  reminder_minutes: number;
};

function cardLink(boardId: string, cardId: string): string {
  return `${env.APP_BASE_URL}/boards/${boardId}?card=${cardId}`;
}

// Scan for cards whose reminder window has opened and email each board member
// once. Idempotent: reminder_sent_at gates a second run.
export async function runDueReminders(
  db: Db,
  email: EmailPort,
  now = new Date(),
): Promise<number> {
  const rows = (await repo.findDueForReminder(db, now)) as DueCardRow[];
  let sent = 0;
  for (const card of rows) {
    const windowStart = card.due_at.getTime() - card.reminder_minutes * 60_000;
    if (windowStart > now.getTime()) continue;

    const column = await db
      .selectFrom("columns")
      .select(["board_id"])
      .where("id", "=", card.column_id)
      .executeTakeFirst();
    if (!column) continue;

    const members = await commentRepo.listBoardMembers(db, column.board_id);
    const link = cardLink(column.board_id, card.id);
    for (const m of members) {
      if (await shouldNotify(db, m.id, NotificationType.CARD_DUE_SOON, "email")) {
        await email.sendCardDueSoon(m.email, card.title, link);
      }
      await createNotification(db, bus, {
        userId: m.id,
        type: NotificationType.CARD_DUE_SOON,
        payload: {
          boardId: column.board_id,
          cardId: card.id,
          actorHandle: null,
          title: card.title,
        },
      });
    }
    await repo.stampReminderSent(db, card.id, now);
    sent += 1;
  }
  return sent;
}
