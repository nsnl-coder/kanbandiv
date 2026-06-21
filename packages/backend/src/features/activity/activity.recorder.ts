import type { ActivityMeta, ActivityTypeValue } from "shared";
import { LogEvent } from "../../config/const.config.js";
import { logger } from "../../logger.js";
import type { Db } from "./activity.repo.js";

// Resolve a card's title for meta on call sites that do not already hold the
// card row. Single-mutation paths only — never used on a list/feed path.
export async function cardTitle(db: Db, cardId: string): Promise<string> {
  const card = await db
    .selectFrom("cards")
    .select(["title"])
    .where("id", "=", cardId)
    .executeTakeFirst();
  return card?.title ?? "card";
}

export interface RecordInput {
  boardId: string;
  cardId?: string | null;
  actorId: string;
  type: ActivityTypeValue;
  meta?: ActivityMeta;
}

// Best-effort audit recorder. Called AFTER the originating write succeeds, on the
// same request/connection. NEVER throws — a dropped audit row must not fail the
// user's real action. meta MUST be JSON.stringify'd: node-pg sends a raw object
// to a jsonb column as "[object Object]" and corrupts the row.
export async function record(db: Db, input: RecordInput): Promise<void> {
  try {
    await db
      .insertInto("activities")
      .values({
        board_id: input.boardId,
        card_id: input.cardId ?? null,
        actor_id: input.actorId,
        type: input.type,
        meta: JSON.stringify(input.meta ?? {}),
      })
      .execute();
  } catch (err) {
    logger.error(
      {
        err,
        event: LogEvent.ActivityRecordFailed,
        type: input.type,
        boardId: input.boardId,
        cardId: input.cardId ?? null,
      },
      LogEvent.ActivityRecordFailed,
    );
  }
}
