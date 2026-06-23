import { z } from "zod";

// Automation taxonomy. A rule = one trigger + an ordered list of actions, scoped
// to a board. Triggers fire from existing mutation sites (card move, checklist
// complete, label add); actions run through the engine. Discriminated unions keep
// the jsonb columns self-describing and validated at the boundary.

export const AutomationTriggerType = {
  CARD_MOVED: "card.moved",
  CHECKLIST_COMPLETED: "checklist.completed",
  LABEL_ADDED: "label.added",
  CARD_DUE_APPROACHING: "card.due.approaching",
} as const;
export type AutomationTriggerTypeValue =
  (typeof AutomationTriggerType)[keyof typeof AutomationTriggerType];

export const AutomationActionType = {
  ASSIGN: "assign",
  ADD_LABEL: "add_label",
  SET_DUE: "set_due",
  MOVE_CARD: "move_card",
  CHECK_ALL_ITEMS: "check_all_items",
  NOTIFY: "notify",
} as const;
export type AutomationActionTypeValue =
  (typeof AutomationActionType)[keyof typeof AutomationActionType];

export const automationTriggerSchema = z.discriminatedUnion("type", [
  // toColumnName null = any move; set = only when the destination column matches.
  z.object({
    type: z.literal(AutomationTriggerType.CARD_MOVED),
    toColumnName: z.string().min(1).max(120).nullable().default(null),
  }),
  z.object({ type: z.literal(AutomationTriggerType.CHECKLIST_COMPLETED) }),
  // labelId null = any label; set = only that label.
  z.object({
    type: z.literal(AutomationTriggerType.LABEL_ADDED),
    labelId: z.string().nullable().default(null),
  }),
  // Fires once per card when now enters [due - minutesBefore, due). Cron-driven.
  z.object({
    type: z.literal(AutomationTriggerType.CARD_DUE_APPROACHING),
    minutesBefore: z.number().int().min(1).max(43_200).default(1_440),
  }),
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(AutomationActionType.ASSIGN), userId: z.string() }),
  z.object({ type: z.literal(AutomationActionType.ADD_LABEL), labelId: z.string() }),
  // due = now + inDays (0 = today).
  z.object({ type: z.literal(AutomationActionType.SET_DUE), inDays: z.number().int().min(0).max(3650) }),
  z.object({ type: z.literal(AutomationActionType.MOVE_CARD), toColumnId: z.string() }),
  z.object({ type: z.literal(AutomationActionType.CHECK_ALL_ITEMS) }),
  z.object({ type: z.literal(AutomationActionType.NOTIFY), userId: z.string() }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const automationActionsSchema = z.array(automationActionSchema).min(1).max(10);

export const automationRuleSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: automationTriggerSchema,
  actions: automationActionsSchema,
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type AutomationRule = z.infer<typeof automationRuleSchema>;

// Run-log detail bag, jsonb. ok/failed counts + an optional skip/error message.
export const automationRunDetailSchema = z.object({
  ok: z.number().int(),
  failed: z.number().int(),
  message: z.string().optional(),
});
export type AutomationRunDetail = z.infer<typeof automationRunDetailSchema>;

export const automationRunSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  cardId: z.string().nullable(),
  status: z.enum(["ok", "error", "skipped"]),
  detail: automationRunDetailSchema,
  createdAt: z.date(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const listAutomationRulesInput = z.object({ boardId: z.string() });
export type ListAutomationRulesInput = z.infer<typeof listAutomationRulesInput>;

export const listAutomationRunsInput = z.object({
  boardId: z.string(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListAutomationRunsInput = z.infer<typeof listAutomationRunsInput>;

export const createAutomationRuleInput = z.object({
  boardId: z.string(),
  name: z.string().min(1).max(120),
  trigger: automationTriggerSchema,
  actions: automationActionsSchema,
  enabled: z.boolean().default(true),
});
export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleInput>;

export const updateAutomationRuleInput = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  trigger: automationTriggerSchema.optional(),
  actions: automationActionsSchema.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleInput>;

export const deleteAutomationRuleInput = z.object({ id: z.string() });
export type DeleteAutomationRuleInput = z.infer<typeof deleteAutomationRuleInput>;
