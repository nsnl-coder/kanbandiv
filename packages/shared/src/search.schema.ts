import { z } from "zod";

export const dueFilterSchema = z.enum(["overdue", "due_soon", "has_due"]);
export type DueFilter = z.infer<typeof dueFilterSchema>;

export const searchCardsInput = z.object({
  q: z.string().max(200).default(""),
  labelIds: z.array(z.string()).optional(),
  assigneeIds: z.array(z.string()).optional(),
  due: dueFilterSchema.optional(),
  projectId: z.string().optional(),
  boardId: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
});
export type SearchCardsInput = z.infer<typeof searchCardsInput>;

export const searchResultSchema = z.object({
  cardId: z.string(),
  title: z.string(),
  snippet: z.string(),
  boardId: z.string(),
  boardName: z.string(),
  columnId: z.string(),
  columnName: z.string(),
  projectId: z.string(),
  dueAt: z.date().nullable(),
  isOverdue: z.boolean(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchPageSchema = z.object({
  items: z.array(searchResultSchema),
  nextOffset: z.number().nullable(),
});
export type SearchPage = z.infer<typeof searchPageSchema>;
