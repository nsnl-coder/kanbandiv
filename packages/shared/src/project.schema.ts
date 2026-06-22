import { z } from "zod";
import { emailSchema } from "./auth.schema.js";

export const ProjectPermission = {
  View: "view",
  Edit: "edit",
} as const;
export type ProjectPermission =
  (typeof ProjectPermission)[keyof typeof ProjectPermission];
export const projectPermissionSchema = z.enum([
  ProjectPermission.View,
  ProjectPermission.Edit,
]);

export const ProjectVisibility = {
  Private: "private",
  Public: "public",
} as const;
export type ProjectVisibility =
  (typeof ProjectVisibility)[keyof typeof ProjectVisibility];
export const projectVisibilitySchema = z.enum([
  ProjectVisibility.Private,
  ProjectVisibility.Public,
]);

// Effective permission of the caller on a project. Owner is implicit (creator).
export type MyPermission = "owner" | ProjectPermission;

export const PROJECT_NAME_MIN = 1;
export const PROJECT_NAME_MAX = 100;
export const PROJECT_DESCRIPTION_MAX = 2000;
export const DEFAULT_PROJECT_COLOR = "#4f46e5";

const nameSchema = z.string().trim().min(PROJECT_NAME_MIN).max(PROJECT_NAME_MAX);
const descriptionSchema = z.string().trim().max(PROJECT_DESCRIPTION_MAX);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "INVALID_COLOR");

export const createProjectInput = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  color: colorSchema.default(DEFAULT_PROJECT_COLOR),
  visibility: projectVisibilitySchema.default(ProjectVisibility.Private),
});
export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const updateProjectInput = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  color: colorSchema.optional(),
  visibility: projectVisibilitySchema.optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectInput>;

export const listProjectsInput = z.object({
  filter: z.enum(["all", "owned", "shared"]).default("all"),
  search: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type ListProjectsInput = z.infer<typeof listProjectsInput>;

export const grantAccessInput = z.object({
  email: emailSchema,
  permission: projectPermissionSchema,
});
export type GrantAccessInput = z.infer<typeof grantAccessInput>;

export const revokeAccessInput = z.object({
  userId: z.string(),
});
export type RevokeAccessInput = z.infer<typeof revokeAccessInput>;

// Reorder a project relative to its sidebar neighbours (fractional position).
export const moveProjectInput = z.object({
  beforeId: z.string().optional(),
  afterId: z.string().optional(),
});
export type MoveProjectInput = z.infer<typeof moveProjectInput>;

export const projectSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string(),
  visibility: projectVisibilitySchema,
  myPermission: z.enum(["owner", ProjectPermission.Edit, ProjectPermission.View]),
  position: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectAccessEntrySchema = z.object({
  userId: z.string(),
  email: z.string(),
  permission: projectPermissionSchema,
});
export type ProjectAccessEntry = z.infer<typeof projectAccessEntrySchema>;
