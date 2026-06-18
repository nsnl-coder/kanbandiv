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

export const boardSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  ownerId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string(),
  myPermission: z.enum(["owner", ProjectPermission.Edit, ProjectPermission.View]),
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

export type { MyPermission };
