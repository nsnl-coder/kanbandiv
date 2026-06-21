import { z } from "zod";
import { emailSchema } from "./auth.schema.js";
import {
  type MyPermission,
  ProjectPermission,
  projectPermissionSchema,
} from "./project.schema.js";
import { columnSchema } from "./column.schema.js";

export const BOARD_NAME_MIN = 1;
export const BOARD_NAME_MAX = 100;
export const BOARD_DESCRIPTION_MAX = 2000;
export const DEFAULT_BOARD_COLOR = "#2563eb";

const nameSchema = z.string().trim().min(BOARD_NAME_MIN).max(BOARD_NAME_MAX);
const descriptionSchema = z.string().trim().max(BOARD_DESCRIPTION_MAX);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "INVALID_COLOR");

export const createBoardInput = z.object({
  projectId: z.string(),
  name: nameSchema,
  description: descriptionSchema.optional(),
  color: colorSchema.default(DEFAULT_BOARD_COLOR),
});
export type CreateBoardInput = z.infer<typeof createBoardInput>;

export const updateBoardInput = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  color: colorSchema.optional(),
});
export type UpdateBoardInput = z.infer<typeof updateBoardInput>;

export const listBoardsInput = z.object({
  projectId: z.string(),
});
export type ListBoardsInput = z.infer<typeof listBoardsInput>;

export const grantBoardAccessInput = z.object({
  email: emailSchema,
  permission: projectPermissionSchema,
});
export type GrantBoardAccessInput = z.infer<typeof grantBoardAccessInput>;

export const revokeBoardAccessInput = z.object({
  userId: z.string(),
});
export type RevokeBoardAccessInput = z.infer<typeof revokeBoardAccessInput>;

export const listArchivedBoardsInput = z.object({
  projectId: z.string(),
});
export type ListArchivedBoardsInput = z.infer<typeof listArchivedBoardsInput>;

export const boardSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  ownerId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string(),
  myPermission: z.enum(["owner", ProjectPermission.Edit, ProjectPermission.View]),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Board = z.infer<typeof boardSchema>;

export const boardAccessEntrySchema = z.object({
  userId: z.string(),
  email: z.string(),
  permission: projectPermissionSchema,
});
export type BoardAccessEntry = z.infer<typeof boardAccessEntrySchema>;

export const boardDataSchema = boardSchema.extend({
  columns: z.array(columnSchema),
});
export type BoardData = z.infer<typeof boardDataSchema>;

// Per-board archived view. Columns are full (FE can render them); archived cards
// use a lean shape (no enrichment) and carry columnName for grouping.
export const archivedColumnSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  name: z.string(),
  position: z.number(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ArchivedColumn = z.infer<typeof archivedColumnSchema>;

export const archivedCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  columnId: z.string(),
  columnName: z.string(),
  archivedAt: z.date().nullable(),
});
export type ArchivedCard = z.infer<typeof archivedCardSchema>;

export const archivedBoardItemsSchema = z.object({
  columns: z.array(archivedColumnSchema),
  cards: z.array(archivedCardSchema),
});
export type ArchivedBoardItems = z.infer<typeof archivedBoardItemsSchema>;

export type { MyPermission };
