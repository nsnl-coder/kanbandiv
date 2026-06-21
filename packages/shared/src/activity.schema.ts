import { z } from "zod";

// Single source of truth for the audit event taxonomy (28 types).
export const ActivityType = {
  // card
  CARD_CREATED: "CARD_CREATED",
  CARD_RENAMED: "CARD_RENAMED",
  CARD_DESCRIPTION_CHANGED: "CARD_DESCRIPTION_CHANGED",
  CARD_MOVED: "CARD_MOVED",
  CARD_DELETED: "CARD_DELETED",
  // label
  LABEL_ATTACHED: "LABEL_ATTACHED",
  LABEL_DETACHED: "LABEL_DETACHED",
  // assignee
  ASSIGNEE_ASSIGNED: "ASSIGNEE_ASSIGNED",
  ASSIGNEE_UNASSIGNED: "ASSIGNEE_UNASSIGNED",
  // due
  DUE_DATE_SET: "DUE_DATE_SET",
  DUE_DATE_CLEARED: "DUE_DATE_CLEARED",
  // cover
  COVER_CHANGED: "COVER_CHANGED",
  // comment
  COMMENT_ADDED: "COMMENT_ADDED",
  // attachment
  ATTACHMENT_ADDED: "ATTACHMENT_ADDED",
  ATTACHMENT_DELETED: "ATTACHMENT_DELETED",
  // checklist
  CHECKLIST_CREATED: "CHECKLIST_CREATED",
  CHECKLIST_DELETED: "CHECKLIST_DELETED",
  // checklist item
  CHECKLIST_ITEM_ADDED: "CHECKLIST_ITEM_ADDED",
  CHECKLIST_ITEM_CHECKED: "CHECKLIST_ITEM_CHECKED",
  CHECKLIST_ITEM_UNCHECKED: "CHECKLIST_ITEM_UNCHECKED",
  // board member
  MEMBER_GRANTED: "MEMBER_GRANTED",
  MEMBER_REVOKED: "MEMBER_REVOKED",
  // archiving
  CARD_ARCHIVED: "CARD_ARCHIVED",
  CARD_RESTORED: "CARD_RESTORED",
  COLUMN_ARCHIVED: "COLUMN_ARCHIVED",
  COLUMN_RESTORED: "COLUMN_RESTORED",
  BOARD_ARCHIVED: "BOARD_ARCHIVED",
  BOARD_RESTORED: "BOARD_RESTORED",
} as const;
export type ActivityTypeValue = (typeof ActivityType)[keyof typeof ActivityType];

// Permissive JSONB bag. Conventional keys per type (BE records / FE renders):
//   cardTitle (every card-scoped event, survives delete)
//   CARD_RENAMED { from, to }; CARD_MOVED { fromColumn, toColumn } (names)
//   CARD_DELETED { cardTitle, cardId }; DUE_DATE_SET { dueAt }
//   COVER_CHANGED { coverKind: "color"|"image"|"none" }
//   LABEL_* { labelName, labelColor }; ASSIGNEE_* { targetEmail, targetHandle }
//   COMMENT_ADDED { snippet }; ATTACHMENT_* { filename }
//   CHECKLIST_* { title }; CHECKLIST_ITEM_* { text, checklistTitle? }
//   MEMBER_GRANTED { targetEmail, targetHandle, permission }
//   MEMBER_REVOKED { targetEmail, targetHandle }
//   CARD_ARCHIVED / CARD_RESTORED { cardTitle }
//   COLUMN_ARCHIVED / COLUMN_RESTORED { columnName }
//   BOARD_ARCHIVED / BOARD_RESTORED { boardName }
export const activityMetaSchema = z.record(z.unknown());
export type ActivityMeta = z.infer<typeof activityMetaSchema>;

export const listCardActivityInput = z.object({ cardId: z.string() });
export type ListCardActivityInput = z.infer<typeof listCardActivityInput>;

export const listBoardActivityInput = z.object({
  boardId: z.string(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});
export type ListBoardActivityInput = z.infer<typeof listBoardActivityInput>;

export const activitySchema = z.object({
  id: z.string(),
  boardId: z.string(),
  cardId: z.string().nullable(),
  type: z.string(),
  meta: activityMetaSchema,
  actor: z.object({ id: z.string().nullable(), handle: z.string() }),
  createdAt: z.date(),
});
export type Activity = z.infer<typeof activitySchema>;

export const boardActivityPageSchema = z.object({
  items: z.array(activitySchema),
  nextOffset: z.number().nullable(),
});
export type BoardActivityPage = z.infer<typeof boardActivityPageSchema>;
