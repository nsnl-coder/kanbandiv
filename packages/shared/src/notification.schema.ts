import { z } from "zod";

// Single source of truth for the notification taxonomy (3 types, mirrors the 3
// email sites: comment @mention, card assigned, card due-soon).
export const NotificationType = {
  MENTION: "MENTION",
  CARD_ASSIGNED: "CARD_ASSIGNED",
  CARD_DUE_SOON: "CARD_DUE_SOON",
} as const;
export type NotificationTypeValue =
  (typeof NotificationType)[keyof typeof NotificationType];

// Self-contained render+link bag, validated at the recorder boundary BEFORE the
// JSONB insert. Carries enough to render + link with no follow-up query.
//   MENTION:       { boardId, cardId, actorHandle, title, snippet }
//   CARD_ASSIGNED: { boardId, cardId, actorHandle, title }
//   CARD_DUE_SOON: { boardId, cardId, actorHandle: null, title }   (null = system)
export const notificationPayloadSchema = z.object({
  boardId: z.string(),
  cardId: z.string().optional(),
  actorHandle: z.string().nullable(),
  title: z.string(),
  snippet: z.string().optional(),
});
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

export const listNotificationsInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type ListNotificationsInput = z.infer<typeof listNotificationsInput>;

export const markReadInput = z.object({ id: z.string() });
export type MarkReadInput = z.infer<typeof markReadInput>;

export const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: notificationPayloadSchema,
  readAt: z.date().nullable(),
  createdAt: z.date(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  nextOffset: z.number().nullable(),
});
export type NotificationPage = z.infer<typeof notificationPageSchema>;

export const unreadCountSchema = z.object({ count: z.number().int() });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

// One delivery preference per notification type. Returned for ALL types (an
// absent DB row resolves to the on/on default), so the UI always has 3 rows.
export const notificationChannelSchema = z.enum(["MENTION", "CARD_ASSIGNED", "CARD_DUE_SOON"]);

export const notificationPrefSchema = z.object({
  type: notificationChannelSchema,
  inApp: z.boolean(),
  email: z.boolean(),
});
export type NotificationPref = z.infer<typeof notificationPrefSchema>;

export const updateNotificationPrefInput = notificationPrefSchema;
export type UpdateNotificationPrefInput = z.infer<typeof updateNotificationPrefInput>;

export const markAllResultSchema = z.object({ updated: z.number().int() });
export type MarkAllResult = z.infer<typeof markAllResultSchema>;
