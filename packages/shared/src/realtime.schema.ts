import { z } from "zod";

// Realtime board-change events fanned out over SSE + Redis pub/sub.
// BOARD_CHANGED: any board structure/content change -> refetch boards.getData.
// CARD_ACTIVITY: a card-scoped change -> also refetch an open card's activity.
export const BoardEventType = {
  BOARD_CHANGED: "BOARD_CHANGED",
  CARD_ACTIVITY: "CARD_ACTIVITY",
} as const;
export type BoardEventTypeValue =
  (typeof BoardEventType)[keyof typeof BoardEventType];

// PRIVACY: carries ONLY these 5 fields. NEVER add card titles, bodies,
// descriptions, or any mutation content - a stale/revoked subscriber must learn
// only "board X changed" then refetch through the authorized boards.getData.
export const boardEventSchema = z.object({
  boardId: z.string(),
  type: z.enum([BoardEventType.BOARD_CHANGED, BoardEventType.CARD_ACTIVITY]),
  actorId: z.string(),
  ts: z.number(),
  cardId: z.string().optional(),
});
export type BoardEvent = z.infer<typeof boardEventSchema>;
