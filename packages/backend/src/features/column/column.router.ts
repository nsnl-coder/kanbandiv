import { z } from "zod";
import {
  columnSchema,
  createColumnInput,
  moveColumnInput,
  okSchema,
  updateColumnInput,
} from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as column from "./column.service.js";

const idInput = z.object({ id: z.string() });

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const columnsRouter = router({
  create: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/columns", tags: ["columns"], protect: true, summary: "Create a column" } })
    .input(createColumnInput)
    .output(columnSchema)
    .mutation(({ ctx, input }) => column.createColumn(ctx.db, user(ctx), input)),

  update: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: "/columns/{id}", tags: ["columns"], protect: true, summary: "Rename a column" } })
    .input(idInput.merge(updateColumnInput))
    .output(columnSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input;
      return column.updateColumn(ctx.db, user(ctx), id, patch);
    }),

  delete: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/columns/{id}", tags: ["columns"], protect: true, summary: "Permanently delete a column (cascade)" } })
    .input(idInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => column.deleteColumn(ctx.db, user(ctx), input.id)),

  archive: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/columns/{id}/archive", tags: ["columns"], protect: true, summary: "Archive a column" } })
    .input(idInput)
    .output(columnSchema)
    .mutation(({ ctx, input }) => column.archiveColumn(ctx.db, user(ctx), input.id)),

  restore: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/columns/{id}/restore", tags: ["columns"], protect: true, summary: "Restore an archived column" } })
    .input(idInput)
    .output(columnSchema)
    .mutation(({ ctx, input }) => column.restoreColumn(ctx.db, user(ctx), input.id)),

  move: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/columns/{id}/move", tags: ["columns"], protect: true, summary: "Reorder a column" } })
    .input(idInput.merge(moveColumnInput))
    .output(columnSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...move } = input;
      return column.moveColumn(ctx.db, user(ctx), id, move);
    }),
});
