import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus, Trash2 } from "lucide-react";
import { CHECKLIST_TITLE_MAX, type Checklist } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { checklistErrorMessage } from "../checklistErrors";
import { progressPercent, sortByPosition } from "../utils";
import { AddChecklistItem } from "./AddChecklistItem";
import { ChecklistItemRow } from "./ChecklistItemRow";

interface Props {
  cardId: string;
  editable: boolean;
}

function midpoint(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return next! - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}

export function ChecklistSection({ cardId, editable }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState("");

  const listQuery = useQuery(trpc.checklists.listByCard.queryOptions({ cardId }));
  const listKey = trpc.checklists.listByCard.queryKey({ cardId });
  const setList = (updater: (d: Checklist[]) => Checklist[]) =>
    queryClient.setQueryData<Checklist[]>(listKey, (prev) => (prev ? updater(prev) : prev));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const createChecklist = useMutation(
    trpc.checklists.create.mutationOptions({ onSettled: invalidate }),
  );
  const deleteChecklist = useMutation(
    trpc.checklists.delete.mutationOptions({ onSettled: invalidate }),
  );
  const createItem = useMutation(
    trpc.checklistItems.create.mutationOptions({ onSettled: invalidate }),
  );
  const updateItem = useMutation(trpc.checklistItems.update.mutationOptions());
  const deleteItem = useMutation(
    trpc.checklistItems.delete.mutationOptions({ onSettled: invalidate }),
  );
  const moveItem = useMutation(trpc.checklistItems.move.mutationOptions());

  const checklists = sortByPosition(listQuery.data ?? []);

  const addChecklist = () => {
    const title = newTitle.trim();
    if (!title) return;
    createChecklist.mutate({ cardId, title });
    setNewTitle("");
  };

  const toggleItem = (checklistId: string, itemId: string, isDone: boolean) => {
    setList((d) =>
      d.map((cl) =>
        cl.id === checklistId
          ? { ...cl, items: cl.items.map((it) => (it.id === itemId ? { ...it, isDone } : it)) }
          : cl,
      ),
    );
    updateItem.mutate({ id: itemId, isDone }, { onSettled: invalidate });
  };

  const onItemDrop = (checklistId: string) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const cl = checklists.find((c) => c.id === checklistId);
    if (!cl) return;
    const items = sortByPosition(cl.items);
    const fromIdx = items.findIndex((i) => i.id === active.id);
    const toIdx = items.findIndex((i) => i.id === over.id);
    if (fromIdx < 0 || toIdx < 0) return;

    const reordered = [...items];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const pos = reordered.findIndex((i) => i.id === moved.id);
    const newPos = midpoint(reordered[pos - 1]?.position, reordered[pos + 1]?.position);

    const snapshot = queryClient.getQueryData<Checklist[]>(listKey);
    setList((d) =>
      d.map((c) =>
        c.id === checklistId
          ? { ...c, items: c.items.map((i) => (i.id === moved.id ? { ...i, position: newPos } : i)) }
          : c,
      ),
    );

    const neighbour =
      reordered[pos + 1]?.id !== undefined
        ? { beforeId: reordered[pos + 1].id }
        : reordered[pos - 1]?.id !== undefined
          ? { afterId: reordered[pos - 1].id }
          : {};
    moveItem.mutate(
      { id: String(active.id), ...neighbour },
      {
        onError: () => {
          if (snapshot) queryClient.setQueryData(listKey, snapshot);
        },
        onSettled: invalidate,
      },
    );
  };

  return (
    <section className="mt-5">
      <h3 className="text-sm font-semibold text-foreground/80">Checklists</h3>

      {listQuery.error ? (
        <p className="mt-1 text-xs text-red-600">{checklistErrorMessage(listQuery.error)}</p>
      ) : null}

      <div className="mt-2 flex flex-col gap-4">
        {checklists.map((cl) => {
          const progress = {
            done: cl.items.filter((i) => i.isDone).length,
            total: cl.items.length,
          };
          const items = sortByPosition(cl.items);
          return (
            <div key={cl.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground/80">{cl.title}</span>
                {editable ? (
                  <button
                    type="button"
                    aria-label={`delete checklist ${cl.title}`}
                    onClick={() => deleteChecklist.mutate({ id: cl.id })}
                    className="text-muted hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              {progress.total > 0 ? (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <span>{progressPercent(progress)}%</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${progressPercent(progress)}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="mt-2">
                <DndContext sensors={sensors} onDragEnd={onItemDrop(cl.id)}>
                  <SortableContext
                    items={items.map((i) => i.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {items.map((item) => (
                      <ChecklistItemRow
                        key={item.id}
                        item={item}
                        editable={editable}
                        onToggle={(isDone) => toggleItem(cl.id, item.id, isDone)}
                        onRename={(text) =>
                          updateItem.mutate({ id: item.id, text }, { onSettled: invalidate })
                        }
                        onDelete={() => deleteItem.mutate({ id: item.id })}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>

              {editable ? (
                <AddChecklistItem
                  onAdd={(text) => createItem.mutate({ checklistId: cl.id, text })}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {editable ? (
        <div className="mt-3 flex items-center gap-2">
          <Plus className="h-4 w-4 text-muted" />
          <input
            aria-label="add checklist"
            value={newTitle}
            placeholder="Add a checklist"
            maxLength={CHECKLIST_TITLE_MAX}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addChecklist();
            }}
            className="flex-1 rounded border border-border px-2 py-1 text-sm outline-none focus:border-indigo-500"
          />
        </div>
      ) : null}
    </section>
  );
}
