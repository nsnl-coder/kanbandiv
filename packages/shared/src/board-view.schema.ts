import { z } from "zod";

// Single source of truth for the board view modes.
export const BoardViewMode = {
  KANBAN: "kanban",
  TABLE: "table",
  CALENDAR: "calendar",
  SWIMLANES: "swimlanes",
} as const;
export type BoardViewModeValue = (typeof BoardViewMode)[keyof typeof BoardViewMode];
export const boardViewModeSchema = z.enum(["kanban", "table", "calendar", "swimlanes"]);

// Re-declared (not imported from search) to avoid cross-feature coupling.
export const dueViewFilterSchema = z.enum(["overdue", "due_soon", "has_due"]);
export type DueViewFilter = z.infer<typeof dueViewFilterSchema>;

export const swimlaneGroupingSchema = z.enum(["label", "assignee"]);
export type SwimlaneGrouping = z.infer<typeof swimlaneGroupingSchema>;

// STRICT: unknown keys are rejected so a malformed config cannot corrupt jsonb.
export const boardViewConfigSchema = z
  .object({
    labelIds: z.array(z.string()).default([]),
    assigneeIds: z.array(z.string()).default([]),
    assignedToMe: z.boolean().default(false),
    due: dueViewFilterSchema.nullable().default(null),
    swimlaneBy: swimlaneGroupingSchema.nullable().default(null),
  })
  .strict();
export type BoardViewConfig = z.infer<typeof boardViewConfigSchema>;

export const getBoardViewInput = z.object({ boardId: z.string() });
export type GetBoardViewInput = z.infer<typeof getBoardViewInput>;

export const setBoardViewInput = z.object({
  boardId: z.string(),
  mode: boardViewModeSchema,
  config: boardViewConfigSchema,
});
export type SetBoardViewInput = z.infer<typeof setBoardViewInput>;

export const boardViewSchema = z.object({
  mode: boardViewModeSchema,
  config: boardViewConfigSchema,
});
export type BoardView = z.infer<typeof boardViewSchema>;

export const defaultBoardView: BoardView = {
  mode: BoardViewMode.KANBAN,
  config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null },
};
