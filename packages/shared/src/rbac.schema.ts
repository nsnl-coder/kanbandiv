import { z } from "zod";

// Per-resource role on a project (inherited by its boards).
export const ResourceRole = {
  Owner: "owner",
  Editor: "editor",
  Viewer: "viewer",
} as const;
export type ResourceRole = (typeof ResourceRole)[keyof typeof ResourceRole];

export const resourceRoleSchema = z.enum(["owner", "editor", "viewer"]);

// Permissions are `<resource>:<action>` strings checked by middleware/UI.
export const Permission = {
  ProjectView: "project:view",
  ProjectUpdate: "project:update",
  ProjectDelete: "project:delete",
  ProjectManageMembers: "project:manage_members",
  BoardCreate: "board:create",
  BoardView: "board:view",
  BoardUpdate: "board:update",
  BoardDelete: "board:delete",
  CardCreate: "card:create",
  CardUpdate: "card:update",
  CardMove: "card:move",
  CardDelete: "card:delete",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const VIEW: Permission[] = [
  Permission.ProjectView,
  Permission.BoardView,
];

const EDIT: Permission[] = [
  ...VIEW,
  Permission.BoardCreate,
  Permission.BoardUpdate,
  Permission.BoardDelete,
  Permission.CardCreate,
  Permission.CardUpdate,
  Permission.CardMove,
  Permission.CardDelete,
];

const ALL: Permission[] = [
  ...EDIT,
  Permission.ProjectUpdate,
  Permission.ProjectDelete,
  Permission.ProjectManageMembers,
];

export const ROLE_PERMISSIONS: Record<ResourceRole, readonly Permission[]> = {
  [ResourceRole.Owner]: ALL,
  [ResourceRole.Editor]: EDIT,
  [ResourceRole.Viewer]: VIEW,
};

/** Whether a resource role grants a permission. Global admin bypasses this. */
export function can(role: ResourceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
