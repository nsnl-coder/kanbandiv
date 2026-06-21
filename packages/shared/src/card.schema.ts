import { z } from "zod";
import { labelSchema } from "./label.schema.js";

export const CARD_TITLE_MIN = 1;
export const CARD_TITLE_MAX = 200;
export const CARD_DESCRIPTION_MAX = 5000;

const titleSchema = z.string().trim().min(CARD_TITLE_MIN).max(CARD_TITLE_MAX);
const descriptionSchema = z.string().trim().max(CARD_DESCRIPTION_MAX);

export const createCardInput = z.object({
  columnId: z.string(),
  title: titleSchema,
  description: descriptionSchema.optional(),
});
export type CreateCardInput = z.infer<typeof createCardInput>;

export const updateCardInput = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  dueAt: z.date().nullable().optional(),
  reminderMinutes: z.number().int().min(0).nullable().optional(),
});
export type UpdateCardInput = z.infer<typeof updateCardInput>;

export const listDueCardsInput = z.object({
  boardId: z.string(),
  from: z.date(),
  to: z.date(),
});
export type ListDueCardsInput = z.infer<typeof listDueCardsInput>;

export const moveCardInput = z.object({
  toColumnId: z.string(),
  beforeId: z.string().optional(),
  afterId: z.string().optional(),
});
export type MoveCardInput = z.infer<typeof moveCardInput>;

export const checklistProgressSchema = z.object({
  done: z.number(),
  total: z.number(),
});
export type ChecklistProgress = z.infer<typeof checklistProgressSchema>;

export const cardSchema = z.object({
  id: z.string(),
  columnId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  position: z.number(),
  dueAt: z.date().nullable(),
  reminderMinutes: z.number().nullable(),
  isOverdue: z.boolean(),
  labels: z.array(labelSchema),
  checklistProgress: checklistProgressSchema,
  commentCount: z.number(),
  attachmentCount: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Card = z.infer<typeof cardSchema>;
