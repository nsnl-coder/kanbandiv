import { TRPCError } from "@trpc/server";
import {
  type AutomationRule,
  type AutomationRun,
  AutomationError,
  automationRuleSchema,
  automationRunSchema,
  type CreateAutomationRuleInput,
  type DeleteAutomationRuleInput,
  type ListAutomationRulesInput,
  type ListAutomationRunsInput,
  type UpdateAutomationRuleInput,
} from "shared";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import * as repo from "./automation.repo.js";
import type { Db } from "./automation.repo.js";

function ruleNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: AutomationError.RULE_NOT_FOUND });
}

function boardNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: AutomationError.BOARD_NOT_FOUND });
}

async function requireBoard(
  db: Db,
  user: CtxUser,
  boardId: string,
  min: "view" | "edit",
): Promise<void> {
  try {
    await loadBoardFor(db, user, boardId, min);
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") throw boardNotFound();
    throw err;
  }
}

type RuleRow = {
  id: string;
  board_id: string;
  name: string;
  enabled: boolean;
  trigger: unknown;
  actions: unknown;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

// Re-parse jsonb at the boundary (mirror getBoardView): a hand-edited or stale
// row must surface as an error, not a corrupt object on the wire.
function toRule(row: RuleRow): AutomationRule {
  return automationRuleSchema.parse({
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger,
    actions: row.actions,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function listRules(
  db: Db,
  user: CtxUser,
  { boardId }: ListAutomationRulesInput,
): Promise<AutomationRule[]> {
  await requireBoard(db, user, boardId, "view");
  const rows = (await repo.listRulesByBoard(db, boardId)) as RuleRow[];
  return rows.map(toRule);
}

export async function createRule(
  db: Db,
  user: CtxUser,
  input: CreateAutomationRuleInput,
): Promise<AutomationRule> {
  await requireBoard(db, user, input.boardId, "edit");
  const row = (await repo.createRule(db, {
    boardId: input.boardId,
    name: input.name,
    enabled: input.enabled,
    trigger: input.trigger,
    actions: input.actions,
    createdBy: user.id,
  })) as RuleRow;
  return toRule(row);
}

async function loadRuleForEdit(db: Db, user: CtxUser, id: string): Promise<RuleRow> {
  const row = (await repo.findRuleById(db, id)) as RuleRow | undefined;
  if (!row) throw ruleNotFound();
  await requireBoard(db, user, row.board_id, "edit");
  return row;
}

export async function updateRule(
  db: Db,
  user: CtxUser,
  input: UpdateAutomationRuleInput,
): Promise<AutomationRule> {
  await loadRuleForEdit(db, user, input.id);
  const updated = (await repo.updateRule(db, input.id, {
    name: input.name,
    enabled: input.enabled,
    trigger: input.trigger,
    actions: input.actions,
  })) as RuleRow | undefined;
  if (!updated) throw ruleNotFound();
  return toRule(updated);
}

export async function deleteRule(
  db: Db,
  user: CtxUser,
  input: DeleteAutomationRuleInput,
): Promise<{ ok: true }> {
  await loadRuleForEdit(db, user, input.id);
  await repo.deleteRule(db, input.id);
  return { ok: true };
}

type RunRow = {
  id: string;
  rule_id: string;
  card_id: string | null;
  status: string;
  detail: unknown;
  created_at: Date;
};

export async function listRuns(
  db: Db,
  user: CtxUser,
  input: ListAutomationRunsInput,
): Promise<AutomationRun[]> {
  await requireBoard(db, user, input.boardId, "view");
  const rows = (await repo.listRunsByBoard(db, input.boardId, input.limit)) as RunRow[];
  return rows.map((r) =>
    automationRunSchema.parse({
      id: r.id,
      ruleId: r.rule_id,
      cardId: r.card_id,
      status: r.status,
      detail: r.detail,
      createdAt: r.created_at,
    }),
  );
}
