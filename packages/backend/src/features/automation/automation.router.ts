import { z } from "zod";
import {
  automationRuleSchema,
  automationRunSchema,
  createAutomationRuleInput,
  deleteAutomationRuleInput,
  listAutomationRulesInput,
  listAutomationRunsInput,
  okSchema,
  updateAutomationRuleInput,
} from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as automation from "./automation.service.js";

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const automationsRouter = router({
  list: protectedProcedure
    .input(listAutomationRulesInput)
    .output(z.array(automationRuleSchema))
    .query(({ ctx, input }) => automation.listRules(ctx.db, user(ctx), input)),

  create: protectedProcedure
    .input(createAutomationRuleInput)
    .output(automationRuleSchema)
    .mutation(({ ctx, input }) => automation.createRule(ctx.db, user(ctx), input)),

  update: protectedProcedure
    .input(updateAutomationRuleInput)
    .output(automationRuleSchema)
    .mutation(({ ctx, input }) => automation.updateRule(ctx.db, user(ctx), input)),

  delete: protectedProcedure
    .input(deleteAutomationRuleInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => automation.deleteRule(ctx.db, user(ctx), input)),

  runs: protectedProcedure
    .input(listAutomationRunsInput)
    .output(z.array(automationRunSchema))
    .query(({ ctx, input }) => automation.listRuns(ctx.db, user(ctx), input)),
});
