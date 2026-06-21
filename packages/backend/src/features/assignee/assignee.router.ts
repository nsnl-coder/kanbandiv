import { z } from "zod";
import {
  assigneeSchema,
  assignInput,
  listAssigneesInput,
  listBoardMembersInput,
  unassignInput,
} from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as assignee from "./assignee.service.js";

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const assigneesRouter = router({
  listForCard: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/cards/{cardId}/assignees", tags: ["assignees"], protect: true, summary: "List a card's assignees" } })
    .input(listAssigneesInput)
    .output(z.array(assigneeSchema))
    .query(({ ctx, input }) => assignee.listAssignees(ctx.db, user(ctx), input)),

  boardMembers: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/boards/{boardId}/members", tags: ["assignees"], protect: true, summary: "List assignable board members" } })
    .input(listBoardMembersInput)
    .output(z.array(assigneeSchema))
    .query(({ ctx, input }) => assignee.listBoardMembers(ctx.db, user(ctx), input)),

  assign: protectedProcedure
    .meta({ openapi: { method: "PUT", path: "/cards/{cardId}/assignees/{userId}", tags: ["assignees"], protect: true, summary: "Assign a board member to a card" } })
    .input(assignInput)
    .output(z.array(assigneeSchema))
    .mutation(({ ctx, input }) =>
      assignee.assign(ctx.db, user(ctx), ctx.email, input),
    ),

  unassign: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/cards/{cardId}/assignees/{userId}", tags: ["assignees"], protect: true, summary: "Unassign a member from a card" } })
    .input(unassignInput)
    .output(z.array(assigneeSchema))
    .mutation(({ ctx, input }) => assignee.unassign(ctx.db, user(ctx), input)),
});
