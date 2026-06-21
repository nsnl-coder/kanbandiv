import { z } from "zod";
import {
  cardSchema,
  createCardInput,
  listDueCardsInput,
  moveCardInput,
  okSchema,
  updateCardInput,
} from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as card from "./card.service.js";
import { storage } from "../attachment/attachment.storage.js";

const idInput = z.object({ id: z.string() });

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const cardsRouter = router({
  due: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/cards/due", tags: ["cards"], protect: true, summary: "List cards with a due date in a window" } })
    .input(listDueCardsInput)
    .output(z.array(cardSchema))
    .query(({ ctx, input }) => card.listDueCards(ctx.db, user(ctx), input)),

  create: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/cards", tags: ["cards"], protect: true, summary: "Create a card" } })
    .input(createCardInput)
    .output(cardSchema)
    .mutation(({ ctx, input }) => card.createCard(ctx.db, user(ctx), input)),

  update: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: "/cards/{id}", tags: ["cards"], protect: true, summary: "Update a card (cover, markdown desc)" } })
    .input(idInput.merge(updateCardInput))
    .output(cardSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input;
      return card.updateCard(ctx.db, user(ctx), id, patch);
    }),

  delete: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/cards/{id}", tags: ["cards"], protect: true, summary: "Permanently delete a card" } })
    .input(idInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => card.deleteCard(ctx.db, storage, user(ctx), input.id)),

  archive: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/cards/{id}/archive", tags: ["cards"], protect: true, summary: "Archive a card" } })
    .input(idInput)
    .output(cardSchema)
    .mutation(({ ctx, input }) => card.archiveCard(ctx.db, user(ctx), input.id)),

  restore: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/cards/{id}/restore", tags: ["cards"], protect: true, summary: "Restore an archived card" } })
    .input(idInput)
    .output(cardSchema)
    .mutation(({ ctx, input }) => card.restoreCard(ctx.db, user(ctx), input.id)),

  move: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/cards/{id}/move", tags: ["cards"], protect: true, summary: "Move or reorder a card" } })
    .input(idInput.merge(moveCardInput))
    .output(cardSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...move } = input;
      return card.moveCard(ctx.db, user(ctx), id, move);
    }),
});
