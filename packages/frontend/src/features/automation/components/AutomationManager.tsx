import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, X } from "lucide-react";
import {
  type AutomationAction,
  AutomationActionType,
  type AutomationRule,
  type AutomationRun,
  type AutomationTrigger,
  AutomationTriggerType,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import { automationErrorMessage } from "../automationErrors";

interface Column {
  id: string;
  name: string;
}

interface Props {
  boardId: string;
  editable: boolean;
  columns: Column[];
}

const TRIGGER_LABEL: Record<string, string> = {
  [AutomationTriggerType.CARD_MOVED]: "When a card is moved",
  [AutomationTriggerType.CHECKLIST_COMPLETED]: "When a checklist is completed",
  [AutomationTriggerType.LABEL_ADDED]: "When a label is added",
  [AutomationTriggerType.CARD_DUE_APPROACHING]: "When a due date approaches",
};

const ACTION_LABEL: Record<string, string> = {
  [AutomationActionType.ASSIGN]: "Assign a member",
  [AutomationActionType.ADD_LABEL]: "Add a label",
  [AutomationActionType.SET_DUE]: "Set a due date",
  [AutomationActionType.MOVE_CARD]: "Move the card",
  [AutomationActionType.CHECK_ALL_ITEMS]: "Check all checklist items",
  [AutomationActionType.NOTIFY]: "Notify a member",
};

const INPUT =
  "rounded border border-border px-2 py-1 text-sm outline-none focus:border-indigo-500 disabled:bg-surface-muted";

function defaultTrigger(type: string): AutomationTrigger {
  if (type === AutomationTriggerType.CARD_MOVED) return { type, toColumnName: null };
  if (type === AutomationTriggerType.LABEL_ADDED) return { type, labelId: null };
  if (type === AutomationTriggerType.CARD_DUE_APPROACHING) return { type, minutesBefore: 1440 };
  return { type: AutomationTriggerType.CHECKLIST_COMPLETED };
}

function defaultAction(type: string): AutomationAction {
  switch (type) {
    case AutomationActionType.ASSIGN:
      return { type, userId: "" };
    case AutomationActionType.NOTIFY:
      return { type, userId: "" };
    case AutomationActionType.ADD_LABEL:
      return { type, labelId: "" };
    case AutomationActionType.SET_DUE:
      return { type, inDays: 1 };
    case AutomationActionType.MOVE_CARD:
      return { type, toColumnId: "" };
    default:
      return { type: AutomationActionType.CHECK_ALL_ITEMS };
  }
}

function actionValid(a: AutomationAction): boolean {
  switch (a.type) {
    case AutomationActionType.ASSIGN:
    case AutomationActionType.NOTIFY:
      return a.userId !== "";
    case AutomationActionType.ADD_LABEL:
      return a.labelId !== "";
    case AutomationActionType.MOVE_CARD:
      return a.toColumnId !== "";
    default:
      return true;
  }
}

export function AutomationManager({ boardId, editable, columns }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const rulesKey = trpc.automations.list.queryKey({ boardId });
  const rulesQuery = useQuery(trpc.automations.list.queryOptions({ boardId }));
  const runsQuery = useQuery(trpc.automations.runs.queryOptions({ boardId, limit: 20 }));
  const labelsQuery = useQuery(trpc.labels.list.queryOptions({ boardId }));
  const membersQuery = useQuery(trpc.assignees.boardMembers.queryOptions({ boardId }));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: rulesKey });
    queryClient.invalidateQueries({ queryKey: trpc.automations.runs.queryKey({ boardId, limit: 20 }) });
  };

  const createMutation = useMutation(trpc.automations.create.mutationOptions({ onSettled: invalidate }));
  const updateMutation = useMutation(trpc.automations.update.mutationOptions({ onSettled: invalidate }));
  const deleteMutation = useMutation(trpc.automations.delete.mutationOptions({ onSettled: invalidate }));

  const rules = rulesQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const labels = labelsQuery.data ?? [];
  const members = membersQuery.data ?? [];

  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationTrigger>(defaultTrigger(AutomationTriggerType.CARD_MOVED));
  const [actions, setActions] = useState<AutomationAction[]>([defaultAction(AutomationActionType.ASSIGN)]);

  const labelName = (id: string) => labels.find((l) => l.id === id)?.name || "label";
  const memberEmail = (id: string) => members.find((m) => m.id === id)?.email || "member";
  const columnName = (id: string) => columns.find((c) => c.id === id)?.name || "column";

  const triggerSummary = (t: AutomationTrigger): string => {
    if (t.type === AutomationTriggerType.CARD_MOVED)
      return t.toColumnName ? `Card moved to "${t.toColumnName}"` : "Card moved (any column)";
    if (t.type === AutomationTriggerType.LABEL_ADDED)
      return t.labelId ? `Label "${labelName(t.labelId)}" added` : "Any label added";
    if (t.type === AutomationTriggerType.CARD_DUE_APPROACHING)
      return `Due in ${t.minutesBefore} min or less`;
    return "Checklist completed";
  };

  const actionSummary = (a: AutomationAction): string => {
    switch (a.type) {
      case AutomationActionType.ASSIGN:
        return `Assign ${memberEmail(a.userId)}`;
      case AutomationActionType.NOTIFY:
        return `Notify ${memberEmail(a.userId)}`;
      case AutomationActionType.ADD_LABEL:
        return `Add label ${labelName(a.labelId)}`;
      case AutomationActionType.SET_DUE:
        return `Set due in ${a.inDays} day(s)`;
      case AutomationActionType.MOVE_CARD:
        return `Move to ${columnName(a.toColumnId)}`;
      default:
        return "Check all items";
    }
  };

  const canCreate =
    name.trim() !== "" && actions.length > 0 && actions.every(actionValid) && !createMutation.isPending;

  const create = () => {
    if (!canCreate) return;
    createMutation.mutate(
      { boardId, name: name.trim(), trigger, actions },
      {
        onSuccess: () => {
          setName("");
          setTrigger(defaultTrigger(AutomationTriggerType.CARD_MOVED));
          setActions([defaultAction(AutomationActionType.ASSIGN)]);
        },
      },
    );
  };

  const error = createMutation.error ?? updateMutation.error ?? deleteMutation.error;

  return (
    <section className="flex flex-col gap-5">
      {error ? <p className="text-sm text-red-600">{automationErrorMessage(error)}</p> : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground/80">Rules</h3>
        <ul className="flex flex-col gap-2">
          {rules.map((rule: AutomationRule) => (
            <li
              key={rule.id}
              className="flex items-start gap-2 rounded-lg border border-border/70 px-3 py-2"
            >
              <label className="mt-0.5 inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={!editable || updateMutation.isPending}
                  onChange={(e) => updateMutation.mutate({ id: rule.id, enabled: e.target.checked })}
                  aria-label={`toggle ${rule.name}`}
                />
              </label>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{rule.name}</p>
                <p className="text-xs text-muted">{triggerSummary(rule.trigger)}</p>
                <p className="text-xs text-muted">{rule.actions.map(actionSummary).join(" - ")}</p>
              </div>
              {editable ? (
                <button
                  type="button"
                  aria-label={`delete rule ${rule.name}`}
                  onClick={() => deleteMutation.mutate({ id: rule.id })}
                  className="text-muted hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
          {rules.length === 0 ? <li className="text-sm text-muted">No rules yet.</li> : null}
        </ul>
      </div>

      {editable ? (
        <div className="rounded-lg border border-border/70 p-3">
          <h3 className="mb-2 text-sm font-semibold text-foreground/80">New rule</h3>
          <div className="flex flex-col gap-3">
            <input
              aria-label="rule name"
              value={name}
              placeholder="Rule name"
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              className={`${INPUT} w-full`}
            />

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="trigger type"
                value={trigger.type}
                onChange={(e) => setTrigger(defaultTrigger(e.target.value))}
                className={INPUT}
              >
                {Object.entries(TRIGGER_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>

              {trigger.type === AutomationTriggerType.CARD_MOVED ? (
                <select
                  aria-label="trigger column"
                  value={trigger.toColumnName ?? ""}
                  onChange={(e) =>
                    setTrigger({
                      type: AutomationTriggerType.CARD_MOVED,
                      toColumnName: e.target.value || null,
                    })
                  }
                  className={INPUT}
                >
                  <option value="">any column</option>
                  {columns.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : null}

              {trigger.type === AutomationTriggerType.LABEL_ADDED ? (
                <select
                  aria-label="trigger label"
                  value={trigger.labelId ?? ""}
                  onChange={(e) =>
                    setTrigger({
                      type: AutomationTriggerType.LABEL_ADDED,
                      labelId: e.target.value || null,
                    })
                  }
                  className={INPUT}
                >
                  <option value="">any label</option>
                  {labels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name || l.color}
                    </option>
                  ))}
                </select>
              ) : null}

              {trigger.type === AutomationTriggerType.CARD_DUE_APPROACHING ? (
                <span className="flex items-center gap-1 text-sm text-muted">
                  <input
                    type="number"
                    aria-label="minutes before due"
                    min={1}
                    max={43200}
                    value={trigger.minutesBefore}
                    onChange={(e) =>
                      setTrigger({
                        type: AutomationTriggerType.CARD_DUE_APPROACHING,
                        minutesBefore: Number(e.target.value) || 1,
                      })
                    }
                    className={`${INPUT} w-24`}
                  />
                  min before
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted">Then</span>
              {actions.map((action, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`action ${idx + 1} type`}
                    value={action.type}
                    onChange={(e) =>
                      setActions((a) => a.map((x, i) => (i === idx ? defaultAction(e.target.value) : x)))
                    }
                    className={INPUT}
                  >
                    {Object.entries(ACTION_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>

                  {(action.type === AutomationActionType.ASSIGN ||
                    action.type === AutomationActionType.NOTIFY) && (
                    <select
                      aria-label={`action ${idx + 1} member`}
                      value={action.userId}
                      onChange={(e) =>
                        setActions((a) =>
                          a.map((x, i) =>
                            i === idx ? { type: action.type, userId: e.target.value } : x,
                          ),
                        )
                      }
                      className={INPUT}
                    >
                      <option value="">select member</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.email}
                        </option>
                      ))}
                    </select>
                  )}

                  {action.type === AutomationActionType.ADD_LABEL && (
                    <select
                      aria-label={`action ${idx + 1} label`}
                      value={action.labelId}
                      onChange={(e) =>
                        setActions((a) =>
                          a.map((x, i) =>
                            i === idx ? { type: AutomationActionType.ADD_LABEL, labelId: e.target.value } : x,
                          ),
                        )
                      }
                      className={INPUT}
                    >
                      <option value="">select label</option>
                      {labels.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name || l.color}
                        </option>
                      ))}
                    </select>
                  )}

                  {action.type === AutomationActionType.MOVE_CARD && (
                    <select
                      aria-label={`action ${idx + 1} column`}
                      value={action.toColumnId}
                      onChange={(e) =>
                        setActions((a) =>
                          a.map((x, i) =>
                            i === idx ? { type: AutomationActionType.MOVE_CARD, toColumnId: e.target.value } : x,
                          ),
                        )
                      }
                      className={INPUT}
                    >
                      <option value="">select column</option>
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {action.type === AutomationActionType.SET_DUE && (
                    <input
                      type="number"
                      aria-label={`action ${idx + 1} days`}
                      min={0}
                      max={3650}
                      value={action.inDays}
                      onChange={(e) =>
                        setActions((a) =>
                          a.map((x, i) =>
                            i === idx
                              ? { type: AutomationActionType.SET_DUE, inDays: Number(e.target.value) || 0 }
                              : x,
                          ),
                        )
                      }
                      className={`${INPUT} w-20`}
                    />
                  )}

                  {actions.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`remove action ${idx + 1}`}
                      onClick={() => setActions((a) => a.filter((_, i) => i !== idx))}
                      className="text-muted hover:text-red-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              ))}

              <button
                type="button"
                onClick={() =>
                  setActions((a) =>
                    a.length < 10 ? [...a, defaultAction(AutomationActionType.ASSIGN)] : a,
                  )
                }
                className="flex w-fit items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700"
              >
                <Plus className="h-4 w-4" />
                Add action
              </button>
            </div>

            <button
              type="button"
              onClick={create}
              disabled={!canCreate}
              className="flex w-fit items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Create rule
            </button>
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground/80">Run history</h3>
        <ul className="flex flex-col gap-1">
          {runs.map((run: AutomationRun) => (
            <li key={run.id} className="flex items-center gap-2 text-xs">
              <span
                className={
                  run.status === "ok"
                    ? "text-emerald-600"
                    : run.status === "skipped"
                      ? "text-amber-600"
                      : "text-red-600"
                }
              >
                {run.status}
              </span>
              <span className="text-muted">
                {run.detail.ok} ok / {run.detail.failed} failed
              </span>
              <span className="text-muted">{new Date(run.createdAt).toLocaleString()}</span>
            </li>
          ))}
          {runs.length === 0 ? <li className="text-sm text-muted">No runs yet.</li> : null}
        </ul>
      </div>
    </section>
  );
}
