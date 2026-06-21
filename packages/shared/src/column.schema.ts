import { z } from "zod";
import { cardSchema } from "./card.schema.js";

export const COLUMN_NAME_MIN = 1;
export const COLUMN_NAME_MAX = 100;

const nameSchema = z.string().trim().min(COLUMN_NAME_MIN).max(COLUMN_NAME_MAX);

export const createColumnInput = z.object({
  boardId: z.string(),
  name: nameSchema,
});
export type CreateColumnInput = z.infer<typeof createColumnInput>;

export const updateColumnInput = z.object({
  name: nameSchema,
});
export type UpdateColumnInput = z.infer<typeof updateColumnInput>;

export const moveColumnInput = z.object({
  beforeId: z.string().optional(),
  afterId: z.string().optional(),
});
export type MoveColumnInput = z.infer<typeof moveColumnInput>;

export const columnSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  name: z.string(),
  position: z.number(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  cards: z.array(cardSchema),
});
export type Column = z.infer<typeof columnSchema>;
