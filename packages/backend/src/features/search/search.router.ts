import { searchCardsInput, searchPageSchema } from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as search from "./search.service.js";

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const searchRouter = router({
  cards: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/search/cards", tags: ["search"], protect: true, summary: "Search accessible cards by title/description with filters" } })
    .input(searchCardsInput)
    .output(searchPageSchema)
    .query(({ ctx, input }) => search.searchCards(ctx.db, user(ctx), input)),
});
