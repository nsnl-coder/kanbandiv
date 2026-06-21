import {
  boardViewSchema,
  getBoardViewInput,
  setBoardViewInput,
} from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as boardView from "./board-view.service.js";

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const boardViewsRouter = router({
  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/boards/{boardId}/view", tags: ["boardViews"], protect: true, summary: "Get the caller's saved view for a board (default when none)" } })
    .input(getBoardViewInput)
    .output(boardViewSchema)
    .query(({ ctx, input }) => boardView.getBoardView(ctx.db, user(ctx), input)),

  set: protectedProcedure
    .meta({ openapi: { method: "PUT", path: "/boards/{boardId}/view", tags: ["boardViews"], protect: true, summary: "Upsert the caller's saved view for a board" } })
    .input(setBoardViewInput)
    .output(boardViewSchema)
    .mutation(({ ctx, input }) => boardView.setBoardView(ctx.db, user(ctx), input)),
});
