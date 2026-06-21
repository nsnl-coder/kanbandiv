import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BoardData, Card, Label, SwimlaneGrouping } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { sortByPosition, assigneeDisplayName } from "../utils";
import { LabelBadge } from "./LabelBadge";
import { DueDateBadge } from "./DueDateBadge";
import { AssigneeStack } from "./AssigneeStack";

interface Props {
  boardId: string;
  columns: BoardData["columns"];
  swimlaneBy: SwimlaneGrouping;
  onOpenCard: (card: Card) => void;
}

interface Lane {
  key: string;
  label: string;
}

// DnD across lanes is OUT OF SCOPE for v1 (lanes are derived from
// labels/assignees, not a stored position). Swimlanes is read-only-reorder:
// clicking a card opens the editor; moving cards stays a kanban-mode action.

function laneCardsForLabel(cards: Card[], laneKey: string): Card[] {
  if (laneKey === "__none__") return cards.filter((c) => c.labels.length === 0);
  return cards.filter((c) => c.labels.some((l) => l.id === laneKey));
}

function laneCardsForAssignee(cards: Card[], laneKey: string): Card[] {
  if (laneKey === "__none__") return cards.filter((c) => c.assignees.length === 0);
  return cards.filter((c) => c.assignees.some((a) => a.id === laneKey));
}

export function BoardSwimlanesView({ boardId, columns, swimlaneBy, onOpenCard }: Props) {
  const trpc = useTRPC();
  const labelsQuery = useQuery(trpc.labels.list.queryOptions({ boardId }));
  const labels: Label[] = labelsQuery.data ?? [];

  const sortedColumns = useMemo(() => sortByPosition(columns), [columns]);
  const allCards = useMemo(() => columns.flatMap((c) => c.cards), [columns]);

  const lanes = useMemo<Lane[]>(() => {
    if (swimlaneBy === "label") {
      const labelLanes = labels.map((l) => ({ key: l.id, label: l.name || "(no name)" }));
      return [...labelLanes, { key: "__none__", label: "No label" }];
    }
    // assignee: derive from the cards' own assignees {id,email}
    const seen = new Map<string, string>();
    for (const c of allCards) {
      for (const a of c.assignees) {
        if (!seen.has(a.id)) seen.set(a.id, assigneeDisplayName(a.email));
      }
    }
    const assigneeLanes = [...seen.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [...assigneeLanes, { key: "__none__", label: "Unassigned" }];
  }, [swimlaneBy, labels, allCards]);

  return (
    <div className="mt-6 flex flex-col gap-6">
      {lanes.map((lane) => (
        <section key={lane.key} aria-label={`lane ${lane.label}`}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">{lane.label}</h3>
          <div className="flex items-start gap-4 overflow-x-auto pb-2">
            {sortedColumns.map((column) => {
              const colCards =
                swimlaneBy === "label"
                  ? laneCardsForLabel(column.cards, lane.key)
                  : laneCardsForAssignee(column.cards, lane.key);
              return (
                <div
                  key={column.id}
                  className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-slate-100 p-3"
                >
                  <h4 className="truncate text-xs font-semibold text-slate-500">{column.name}</h4>
                  {sortByPosition(colCards).map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => onOpenCard(card)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      {card.labels.length > 0 ? (
                        <span className="mb-1.5 flex flex-wrap gap-1">
                          {card.labels.map((label) => (
                            <LabelBadge key={label.id} label={label} compact />
                          ))}
                        </span>
                      ) : null}
                      <span className="block">{card.title}</span>
                      <DueDateBadge card={card} />
                      {card.assignees.length > 0 ? (
                        <span className="mt-1.5 block">
                          <AssigneeStack assignees={card.assignees} />
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
