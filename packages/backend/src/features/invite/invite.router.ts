import { z } from "zod";
import {
  listInvitesInput,
  okSchema,
  pendingInviteSchema,
  revokeInviteInput,
} from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as invite from "./invite.service.js";

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const invitesRouter = router({
  listForScope: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/invites", tags: ["invites"], protect: true, summary: "List pending invites for a project or board" } })
    .input(listInvitesInput)
    .output(z.array(pendingInviteSchema))
    .query(({ ctx, input }) =>
      invite.listForScope(ctx.db, user(ctx), input.scope, input.scopeId),
    ),

  revoke: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/invites/{id}", tags: ["invites"], protect: true, summary: "Revoke a pending invite" } })
    .input(revokeInviteInput)
    .output(okSchema)
    .mutation(async ({ ctx, input }) => {
      await invite.revoke(ctx.db, user(ctx), input.id);
      return { ok: true as const };
    }),
});
