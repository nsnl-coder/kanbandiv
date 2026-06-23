import {
  type AutomationAction,
  AutomationActionType,
  type AutomationRunDetail,
  type AutomationTrigger,
  AutomationTriggerType,
  automationActionsSchema,
  automationTriggerSchema,
  NotificationType,
} from "shared";
import { LogEvent } from "../../config/const.config.js";
import { logger } from "../../logger.js";
import { create as createNotification } from "../notification/notification.recorder.js";
import { bus } from "../realtime/realtime.bus.js";
import * as repo from "./automation.repo.js";
import type { Db } from "./automation.repo.js";

// Cap re-entrancy. Actions run through repos and do NOT re-invoke the engine, so
// in practice depth stays 0; the guard exists so any future action that re-emits
// a trigger cannot loop forever.
const MAX_DEPTH = 3;

export interface CardMovedContext {
  boardId: string;
  cardId: string;
  actorId: string;
  toColumnName: string;
}
export interface CardEventContext {
  boardId: string;
  cardId: string;
  actorId: string;
}
export interface LabelAddedContext extends CardEventContext {
  labelId: string;
}

type Matched = { id: string; trigger: AutomationTrigger; actions: AutomationAction[] };

// Defensive parse of an enabled rule row; a corrupt jsonb rule is skipped, not fatal.
function parseRule(row: { id: string; trigger: unknown; actions: unknown }): Matched | null {
  const trigger = automationTriggerSchema.safeParse(row.trigger);
  const actions = automationActionsSchema.safeParse(row.actions);
  if (!trigger.success || !actions.success) return null;
  return { id: row.id, trigger: trigger.data, actions: actions.data };
}

async function loadMatching(
  db: Db,
  boardId: string,
  predicate: (t: AutomationTrigger) => boolean,
): Promise<Matched[]> {
  const rows = await repo.listEnabledByBoard(db, boardId);
  const out: Matched[] = [];
  for (const r of rows) {
    const parsed = parseRule(r);
    if (parsed && predicate(parsed.trigger)) out.push(parsed);
  }
  return out;
}

// Run one action against a card. Returns true on success. Never throws.
async function runAction(
  db: Db,
  ctx: CardEventContext,
  action: AutomationAction,
): Promise<boolean> {
  try {
    switch (action.type) {
      case AutomationActionType.ASSIGN:
        await repo.assignUser(db, ctx.cardId, action.userId);
        return true;
      case AutomationActionType.ADD_LABEL:
        await repo.attachLabel(db, ctx.cardId, action.labelId);
        return true;
      case AutomationActionType.SET_DUE:
        await repo.setDue(db, ctx.cardId, new Date(Date.now() + action.inDays * 86_400_000));
        return true;
      case AutomationActionType.MOVE_CARD: {
        const target = await repo.findColumnById(db, action.toColumnId);
        if (!target || target.board_id !== ctx.boardId) return false;
        const pos = (await repo.maxCardPosition(db, action.toColumnId)) + 1;
        await repo.moveCardToColumn(db, ctx.cardId, action.toColumnId, pos);
        return true;
      }
      case AutomationActionType.CHECK_ALL_ITEMS:
        await repo.checkAllItems(db, ctx.cardId);
        return true;
      case AutomationActionType.NOTIFY: {
        const card = await repo.cardTitle(db, ctx.cardId);
        await createNotification(db, bus, {
          userId: action.userId,
          type: NotificationType.AUTOMATION,
          payload: {
            boardId: ctx.boardId,
            cardId: ctx.cardId,
            actorHandle: null,
            title: card?.title ?? "card",
          },
        });
        return true;
      }
      default:
        return false;
    }
  } catch (err) {
    logger.error(
      { err, event: LogEvent.AutomationFailed, action: (action as { type: string }).type },
      LogEvent.AutomationFailed,
    );
    return false;
  }
}

async function runRules(
  db: Db,
  ctx: CardEventContext,
  rules: Matched[],
  depth: number,
): Promise<void> {
  for (const rule of rules) {
    if (depth >= MAX_DEPTH) {
      await repo
        .recordRun(db, {
          ruleId: rule.id,
          cardId: ctx.cardId,
          status: "skipped",
          detail: { ok: 0, failed: 0, message: "max depth" },
        })
        .catch(() => {});
      logger.warn({ event: LogEvent.AutomationSkipped, ruleId: rule.id }, LogEvent.AutomationSkipped);
      continue;
    }
    let ok = 0;
    let failed = 0;
    for (const action of rule.actions) {
      if (await runAction(db, ctx, action)) ok += 1;
      else failed += 1;
    }
    const detail: AutomationRunDetail = { ok, failed };
    await repo
      .recordRun(db, {
        ruleId: rule.id,
        cardId: ctx.cardId,
        status: failed === 0 ? "ok" : "error",
        detail,
      })
      .catch(() => {});
    logger.info({ event: LogEvent.AutomationRan, ruleId: rule.id, ok, failed }, LogEvent.AutomationRan);
  }
}

// ----- public trigger entrypoints (best-effort; never throw to the caller) -----

export async function onCardMoved(db: Db, ctx: CardMovedContext, depth = 0): Promise<void> {
  try {
    const rules = await loadMatching(
      db,
      ctx.boardId,
      (t) =>
        t.type === AutomationTriggerType.CARD_MOVED &&
        (t.toColumnName === null || t.toColumnName === ctx.toColumnName),
    );
    await runRules(db, ctx, rules, depth);
  } catch (err) {
    logger.error({ err, event: LogEvent.AutomationFailed }, LogEvent.AutomationFailed);
  }
}

export async function onChecklistCompleted(db: Db, ctx: CardEventContext, depth = 0): Promise<void> {
  try {
    const rules = await loadMatching(
      db,
      ctx.boardId,
      (t) => t.type === AutomationTriggerType.CHECKLIST_COMPLETED,
    );
    await runRules(db, ctx, rules, depth);
  } catch (err) {
    logger.error({ err, event: LogEvent.AutomationFailed }, LogEvent.AutomationFailed);
  }
}

export async function onLabelAdded(db: Db, ctx: LabelAddedContext, depth = 0): Promise<void> {
  try {
    const rules = await loadMatching(
      db,
      ctx.boardId,
      (t) =>
        t.type === AutomationTriggerType.LABEL_ADDED &&
        (t.labelId === null || t.labelId === ctx.labelId),
    );
    await runRules(db, ctx, rules, depth);
  } catch (err) {
    logger.error({ err, event: LogEvent.AutomationFailed }, LogEvent.AutomationFailed);
  }
}

// Cron entrypoint. Scans every enabled due-approaching rule and fires it once per
// card that has entered its window. Dedup via the run log. Returns rules fired.
export async function runDueApproaching(db: Db, now = new Date()): Promise<number> {
  let fired = 0;
  try {
    const rows = await repo.listAllEnabledRules(db);
    for (const row of rows) {
      const parsed = parseRule(row);
      if (!parsed || parsed.trigger.type !== AutomationTriggerType.CARD_DUE_APPROACHING) continue;
      const minutesBefore = parsed.trigger.minutesBefore;
      const boardId = (row as { board_id: string }).board_id;
      const cards = await repo.listDueCandidateCards(db, boardId, now);
      for (const card of cards) {
        const due = card.due_at as Date | null;
        if (!due) continue;
        const windowStart = due.getTime() - minutesBefore * 60_000;
        if (windowStart > now.getTime()) continue;
        if (await repo.hasRunForCard(db, parsed.id, card.id)) continue;
        await runRules(db, { boardId, cardId: card.id, actorId: "" }, [parsed], 0);
        fired += 1;
      }
    }
  } catch (err) {
    logger.error({ err, event: LogEvent.AutomationFailed }, LogEvent.AutomationFailed);
  }
  return fired;
}
