import type { Kysely } from "kysely";
import type {
  AutomationAction,
  AutomationRunDetail,
  AutomationTrigger,
} from "shared";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export interface CreateRuleRow {
  boardId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  createdBy: string | null;
}

// trigger/actions are jsonb: stringify on write (node-pg corrupts a raw object).
export function createRule(db: Db, input: CreateRuleRow) {
  return db
    .insertInto("automation_rules")
    .values({
      board_id: input.boardId,
      name: input.name,
      enabled: input.enabled,
      trigger: JSON.stringify(input.trigger),
      actions: JSON.stringify(input.actions),
      created_by: input.createdBy,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findRuleById(db: Db, id: string) {
  return db
    .selectFrom("automation_rules")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export function listRulesByBoard(db: Db, boardId: string) {
  return db
    .selectFrom("automation_rules")
    .selectAll()
    .where("board_id", "=", boardId)
    .orderBy("created_at", "asc")
    .execute();
}

export interface UpdateRulePatch {
  name?: string;
  enabled?: boolean;
  trigger?: AutomationTrigger;
  actions?: AutomationAction[];
}

export function updateRule(db: Db, id: string, patch: UpdateRulePatch) {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.trigger !== undefined) set.trigger = JSON.stringify(patch.trigger);
  if (patch.actions !== undefined) set.actions = JSON.stringify(patch.actions);
  return db
    .updateTable("automation_rules")
    .set(set)
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function deleteRule(db: Db, id: string) {
  return db.deleteFrom("automation_rules").where("id", "=", id).execute();
}

// Engine read path: all enabled rules for a board. Trigger-type + param matching
// happens in the engine (JS) to stay portable across the pg-mem test DB.
export function listEnabledByBoard(db: Db, boardId: string) {
  return db
    .selectFrom("automation_rules")
    .selectAll()
    .where("board_id", "=", boardId)
    .where("enabled", "=", true)
    .orderBy("created_at", "asc")
    .execute();
}

// Cron read path: every enabled rule across all boards. Trigger type is matched
// in JS (jsonb), same as listEnabledByBoard.
export function listAllEnabledRules(db: Db) {
  return db
    .selectFrom("automation_rules")
    .selectAll()
    .where("enabled", "=", true)
    .orderBy("created_at", "asc")
    .execute();
}

// Future-due, live cards on a board (mirrors card reminder scan, per board).
export function listDueCandidateCards(db: Db, boardId: string, now: Date) {
  return db
    .selectFrom("cards")
    .innerJoin("columns", "columns.id", "cards.column_id")
    .innerJoin("boards", "boards.id", "columns.board_id")
    .select(["cards.id as id", "cards.due_at as due_at"])
    .where("columns.board_id", "=", boardId)
    .where("cards.due_at", ">=", now)
    .where("cards.archived_at", "is", null)
    .where("columns.archived_at", "is", null)
    .where("boards.archived_at", "is", null)
    .execute();
}

// Dedup guard for cron triggers: a recorded run means the rule already fired
// for this card, so the due-approaching scan skips it on later passes.
export async function hasRunForCard(db: Db, ruleId: string, cardId: string): Promise<boolean> {
  const row = await db
    .selectFrom("automation_runs")
    .select("id")
    .where("rule_id", "=", ruleId)
    .where("card_id", "=", cardId)
    .executeTakeFirst();
  return Boolean(row);
}

export async function recordRun(
  db: Db,
  input: { ruleId: string; cardId: string | null; status: string; detail: AutomationRunDetail },
): Promise<void> {
  await db
    .insertInto("automation_runs")
    .values({
      rule_id: input.ruleId,
      card_id: input.cardId,
      status: input.status,
      detail: JSON.stringify(input.detail),
    })
    .execute();
}

export function listRunsByBoard(db: Db, boardId: string, limit: number) {
  return db
    .selectFrom("automation_runs")
    .innerJoin("automation_rules", "automation_rules.id", "automation_runs.rule_id")
    .select([
      "automation_runs.id as id",
      "automation_runs.rule_id as rule_id",
      "automation_runs.card_id as card_id",
      "automation_runs.status as status",
      "automation_runs.detail as detail",
      "automation_runs.created_at as created_at",
    ])
    .where("automation_rules.board_id", "=", boardId)
    .orderBy("automation_runs.created_at", "desc")
    .limit(limit)
    .execute();
}

// ----- engine action/context helpers (repo-level, board already authorized) -----

export function findCardById(db: Db, id: string) {
  return db.selectFrom("cards").selectAll().where("id", "=", id).executeTakeFirst();
}

export function findColumnById(db: Db, id: string) {
  return db.selectFrom("columns").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function maxCardPosition(db: Db, columnId: string): Promise<number> {
  const row = await db
    .selectFrom("cards")
    .select((eb) => eb.fn.max("position").as("max"))
    .where("column_id", "=", columnId)
    .executeTakeFirst();
  return (row?.max as number | null) ?? 0;
}

export async function assignUser(db: Db, cardId: string, userId: string): Promise<void> {
  await db
    .insertInto("card_assignees")
    .values({ card_id: cardId, user_id: userId })
    .onConflict((oc) => oc.columns(["card_id", "user_id"]).doNothing())
    .execute();
}

export async function attachLabel(db: Db, cardId: string, labelId: string): Promise<void> {
  await db
    .insertInto("card_labels")
    .values({ card_id: cardId, label_id: labelId })
    .onConflict((oc) => oc.columns(["card_id", "label_id"]).doNothing())
    .execute();
}

export async function setDue(db: Db, cardId: string, dueAt: Date): Promise<void> {
  await db
    .updateTable("cards")
    .set({ due_at: dueAt, reminder_sent_at: null, updated_at: new Date() })
    .where("id", "=", cardId)
    .execute();
}

export async function moveCardToColumn(
  db: Db,
  cardId: string,
  columnId: string,
  position: number,
): Promise<void> {
  await db
    .updateTable("cards")
    .set({ column_id: columnId, position, updated_at: new Date() })
    .where("id", "=", cardId)
    .execute();
}

export async function checkAllItems(db: Db, cardId: string): Promise<void> {
  const checklists = await db
    .selectFrom("checklists")
    .select(["id"])
    .where("card_id", "=", cardId)
    .execute();
  const ids = checklists.map((c) => c.id);
  if (ids.length === 0) return;
  await db
    .updateTable("checklist_items")
    .set({ is_done: true, updated_at: new Date() })
    .where("checklist_id", "in", ids)
    .execute();
}

export function cardTitle(db: Db, cardId: string) {
  return db
    .selectFrom("cards")
    .select(["title"])
    .where("id", "=", cardId)
    .executeTakeFirst();
}
