import { z } from "zod";
import { projectPermissionSchema } from "./project.schema.js";

export const InviteScope = {
  Project: "project",
  Board: "board",
} as const;
export type InviteScopeValue = (typeof InviteScope)[keyof typeof InviteScope];
export const inviteScopeSchema = z.enum([InviteScope.Project, InviteScope.Board]);

export const listInvitesInput = z.object({
  scope: inviteScopeSchema,
  scopeId: z.string(),
});
export type ListInvitesInput = z.infer<typeof listInvitesInput>;

export const revokeInviteInput = z.object({
  id: z.string(),
});
export type RevokeInviteInput = z.infer<typeof revokeInviteInput>;

// A pending invite as shown in an access panel (active grants are listed
// separately). invitedByEmail lets the UI attribute who sent it.
export const pendingInviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  permission: projectPermissionSchema,
  invitedByEmail: z.string().nullable(),
  createdAt: z.date(),
});
export type PendingInvite = z.infer<typeof pendingInviteSchema>;
