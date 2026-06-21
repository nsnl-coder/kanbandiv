import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { BoardData, Card } from "shared";
import { LabelBadge } from "./LabelBadge";
import { DueDateBadge } from "./DueDateBadge";
import { AssigneeStack } from "./AssigneeStack";

type SortKey = "title" | "column" | "due";
type SortDir = "asc" | "desc";

interface Row {
  card: Card;
  columnName: string;
}

interface Props {
  columns: BoardData["columns"];
  onOpenCard: (card: Card) => void;
}

function compare(a: Row, b: Row, key: SortKey): number {
  if (key === "title") return a.card.title.localeCompare(b.card.title);
  if (key === "column") return a.columnName.localeCompare(b.columnName);
  // due: null always last (regardless of direction is applied by caller)
  const av = a.card.dueAt?.getTime();
  const bv = b.card.dueAt?.getTime();
  if (av === undefined && bv === undefined) return 0;
  if (av === undefined) return 1;
  if (bv === undefined) return -1;
  return av - bv;
}

export function BoardTableView({ columns, onOpenCard }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const rows = useMemo<Row[]>(
    () => columns.flatMap((col) => col.cards.map((card) => ({ card, columnName: col.name }))),
    [columns],
  );

  const sorted = useMemo(() => {
    const out = [...rows].sort((a, b) => compare(a, b, sortKey));
    if (sortDir === "desc") {
      // Keep null-due rows last even when descending.
      if (sortKey === "due") {
        const withDue = out.filter((r) => r.card.dueAt);
        const noDue = out.filter((r) => !r.card.dueAt);
        return [...withDue.reverse(), ...noDue];
      }
      return out.reverse();
    }
    return out;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  if (rows.length === 0) {
    return <p className="mt-6 text-sm text-slate-500">No cards match the current filters.</p>;
  }

  const header = (key: SortKey, label: string) => (
    <th className="px-3 py-2 text-left font-semibold text-slate-600">
      <button
        type="button"
        aria-label={`sort by ${label}`}
        onClick={() => toggleSort(key)}
        className="inline-flex items-center gap-1 hover:text-slate-900"
      >
        {label}
        {sortKey === key ? (
          sortDir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )
        ) : null}
      </button>
    </th>
  );

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            {header("title", "Title")}
            {header("column", "Column")}
            <th className="px-3 py-2 text-left font-semibold text-slate-600">Assignees</th>
            <th className="px-3 py-2 text-left font-semibold text-slate-600">Labels</th>
            {header("due", "Due")}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ card, columnName }) => (
            <tr key={card.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onOpenCard(card)}
                  className="text-left font-medium text-slate-800 hover:text-indigo-600"
                >
                  {card.title}
                </button>
              </td>
              <td className="px-3 py-2 text-slate-600">{columnName}</td>
              <td className="px-3 py-2">
                <AssigneeStack assignees={card.assignees} />
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {card.labels.map((label) => (
                    <LabelBadge key={label.id} label={label} compact />
                  ))}
                </div>
              </td>
              <td className="px-3 py-2">
                <DueDateBadge card={card} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
