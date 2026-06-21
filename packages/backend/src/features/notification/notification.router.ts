import { z } from "zod";
import {
  listNotificationsInput,
  markAllResultSchema,
  markReadInput,
  notificationPageSchema,
  notificationPrefSchema,
  unreadCountSchema,
  updateNotificationPrefInput,
} from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as notification from "./notification.service.js";

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const notificationsRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/me/notifications", tags: ["notifications"], protect: true, summary: "List the caller's notifications (newest-first)" } })
    .input(listNotificationsInput)
    .output(notificationPageSchema)
    .query(({ ctx, input }) => notification.list(ctx.db, user(ctx), input)),

  unreadCount: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/me/notifications/unread-count", tags: ["notifications"], protect: true, summary: "Count the caller's unread notifications" } })
    .input(z.void())
    .output(unreadCountSchema)
    .query(({ ctx }) => notification.unreadCount(ctx.db, user(ctx))),

  markRead: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/me/notifications/{id}/read", tags: ["notifications"], protect: true, summary: "Mark one of the caller's notifications read" } })
    .input(markReadInput)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => notification.markRead(ctx.db, user(ctx), input)),

  markAllRead: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/me/notifications/read-all", tags: ["notifications"], protect: true, summary: "Mark all the caller's notifications read" } })
    .input(z.void())
    .output(markAllResultSchema)
    .mutation(({ ctx }) => notification.markAllRead(ctx.db, user(ctx))),

  prefsList: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/me/notifications/prefs", tags: ["notifications"], protect: true, summary: "List the caller's notification delivery preferences" } })
    .input(z.void())
    .output(z.array(notificationPrefSchema))
    .query(({ ctx }) => notification.listPrefs(ctx.db, user(ctx))),

  prefsSet: protectedProcedure
    .meta({ openapi: { method: "PUT", path: "/me/notifications/prefs", tags: ["notifications"], protect: true, summary: "Update one notification type's delivery preference" } })
    .input(updateNotificationPrefInput)
    .output(notificationPrefSchema)
    .mutation(({ ctx, input }) => notification.setPref(ctx.db, user(ctx), input)),
});
