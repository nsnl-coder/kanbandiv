import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Card } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { filterCards, type CardFilter } from "../utils";
import { DueDateBadge } from "./DueDateBadge";
import { LabelBadge } from "./LabelBadge";
import { AssigneeStack } from "./AssigneeStack";

interface Props {
  boardId: string;
  filter: CardFilter;
  onOpenCard: (card: Card) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthRange(cursor: Date): { from: Date; to: Date } {
  const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

// Weeks x 7 cells covering the whole month (leading/trailing days from neighbours).
function buildGrid(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function BoardCalendarView({ boardId, filter, onOpenCard }: Props) {
  const trpc = useTRPC();
  const [cursor, setCursor] = useState(() => new Date());
  const { from, to } = monthRange(cursor);

  const dueQuery = useQuery(trpc.cards.due.queryOptions({ boardId, from, to }));
  // AUDIT L3: skip the `due` predicate - the calendar axis IS the due date.
  const cards = useMemo(
    () => filterCards(dueQuery.data ?? [], { ...filter, due: null }),
    [dueQuery.data, filter],
  );

  const grid = useMemo(() => buildGrid(cursor), [cursor]);

  const monthLabel = cursor.toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{monthLabel}</h2>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="previous month"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            className="rounded-lg border border-border p-1.5 text-foreground/80 hover:bg-surface-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="next month"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            className="rounded-lg border border-border p-1.5 text-foreground/80 hover:bg-surface-muted"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {dueQuery.isLoading ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted">No cards with due dates this month.</p>
      ) : null}

      <div className="grid grid-cols-7 gap-px rounded-lg bg-surface-muted">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-canvas px-2 py-1 text-center text-xs font-semibold text-muted">
            {d}
          </div>
        ))}
        {grid.map((day) => {
          const inMonth = day.getMonth() === cursor.getMonth();
          const dayCards = cards.filter((c) => c.dueAt && sameDay(c.dueAt, day));
          return (
            <div
              key={day.toISOString()}
              data-day={`${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`}
              className={`min-h-24 bg-surface p-1.5 ${inMonth ? "" : "opacity-40"}`}
            >
              <div className="text-right text-xs font-medium text-muted">{day.getDate()}</div>
              <div className="mt-1 flex flex-col gap-1">
                {dayCards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => onOpenCard(card)}
                    className="rounded border border-border bg-surface p-1 text-left text-xs text-foreground/80 shadow-sm hover:bg-canvas"
                  >
                    <span className="block truncate font-medium">{card.title}</span>
                    {card.labels.length > 0 ? (
                      <span className="mt-0.5 flex flex-wrap gap-0.5">
                        {card.labels.map((label) => (
                          <LabelBadge key={label.id} label={label} compact />
                        ))}
                      </span>
                    ) : null}
                    <DueDateBadge card={card} />
                    {card.assignees.length > 0 ? (
                      <span className="mt-0.5 block">
                        <AssigneeStack assignees={card.assignees} />
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
