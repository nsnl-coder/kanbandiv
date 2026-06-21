import { z } from "zod";
import {
  activitySchema,
  boardActivityPageSchema,
  listBoardActivityInput,
  listCardActivityInput,
} from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as activity from "./activity.service.js";

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const activityRouter = router({
  listForCard: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/cards/{cardId}/activity", tags: ["activity"], protect: true, summary: "List a card's activity (newest-first)" } })
    .input(listCardActivityInput)
    .output(z.array(activitySchema))
    .query(({ ctx, input }) => activity.listCardActivity(ctx.db, user(ctx), input)),

  listForBoard: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/boards/{boardId}/activity", tags: ["activity"], protect: true, summary: "Paginated board activity feed (newest-first)" } })
    .input(listBoardActivityInput)
    .output(boardActivityPageSchema)
    .query(({ ctx, input }) => activity.listBoardActivity(ctx.db, user(ctx), input)),
});
