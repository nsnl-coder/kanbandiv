import { z } from "zod";

export const listAssigneesInput = z.object({ cardId: z.string() });
export type ListAssigneesInput = z.infer<typeof listAssigneesInput>;

export const listBoardMembersInput = z.object({ boardId: z.string() });
export type ListBoardMembersInput = z.infer<typeof listBoardMembersInput>;

export const assignInput = z.object({
  cardId: z.string(),
  userId: z.string(),
});
export type AssignInput = z.infer<typeof assignInput>;

export const unassignInput = z.object({
  cardId: z.string(),
  userId: z.string(),
});
export type UnassignInput = z.infer<typeof unassignInput>;

export const assigneeSchema = z.object({
  id: z.string(),
  email: z.string(),
});
export type Assignee = z.infer<typeof assigneeSchema>;
