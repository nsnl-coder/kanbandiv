import { z } from "zod";
import {
  cardSchema,
  cardTemplateSchema,
  createCardTemplateInput,
  instantiateCardTemplateInput,
  listCardTemplatesInput,
  okSchema,
  updateCardTemplateInput,
} from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as service from "./card-template.service.js";

const idInput = z.object({ id: z.string() });

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const cardTemplatesRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/card-templates", tags: ["cardTemplates"], protect: true, summary: "List a board's card templates" } })
    .input(listCardTemplatesInput)
    .output(z.array(cardTemplateSchema))
    .query(({ ctx, input }) => service.listTemplates(ctx.db, user(ctx), input.boardId)),

  create: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/card-templates", tags: ["cardTemplates"], protect: true, summary: "Create a card template" } })
    .input(createCardTemplateInput)
    .output(cardTemplateSchema)
    .mutation(({ ctx, input }) => service.createTemplate(ctx.db, user(ctx), input)),

  update: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: "/card-templates/{id}", tags: ["cardTemplates"], protect: true, summary: "Update a card template" } })
    .input(idInput.merge(updateCardTemplateInput))
    .output(cardTemplateSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input;
      return service.updateTemplate(ctx.db, user(ctx), id, patch);
    }),

  delete: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/card-templates/{id}", tags: ["cardTemplates"], protect: true, summary: "Delete a card template" } })
    .input(idInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => service.deleteTemplate(ctx.db, user(ctx), input.id)),

  instantiate: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/card-templates/{id}/instantiate", tags: ["cardTemplates"], protect: true, summary: "Create a card from a template" } })
    .input(idInput.merge(instantiateCardTemplateInput))
    .output(cardSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...rest } = input;
      return service.instantiate(ctx.db, user(ctx), id, rest);
    }),
});
