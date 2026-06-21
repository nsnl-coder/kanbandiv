import { z } from "zod";
import { attachmentSchema, deleteAttachmentInput, listAttachmentsInput, okSchema } from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as attachment from "./attachment.service.js";
import { storage } from "./attachment.storage.js";

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const attachmentsRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/attachments", tags: ["attachments"], protect: true, summary: "List a card's attachments" } })
    .input(listAttachmentsInput)
    .output(z.array(attachmentSchema))
    .query(({ ctx, input }) => attachment.listAttachments(ctx.db, user(ctx), input)),

  delete: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/attachments/{id}", tags: ["attachments"], protect: true, summary: "Delete an attachment" } })
    .input(deleteAttachmentInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => attachment.deleteAttachment(ctx.db, storage, user(ctx), input)),
});
