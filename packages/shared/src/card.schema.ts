import { z } from "zod";
import { assigneeSchema } from "./assignee.schema.js";
import { labelSchema } from "./label.schema.js";

export const CARD_TITLE_MIN = 1;
export const CARD_TITLE_MAX = 200;
export const CARD_DESCRIPTION_MAX = 5000;

const titleSchema = z.string().trim().min(CARD_TITLE_MIN).max(CARD_TITLE_MAX);
// description holds Markdown SOURCE (still bounded by CARD_DESCRIPTION_MAX).
// Rendering/sanitization is a frontend concern; raw text is never executed server-side.
const descriptionSchema = z.string().trim().max(CARD_DESCRIPTION_MAX);

// Cover palette KEYS (frontend maps key -> Tailwind class; stored value is stable).
export const COVER_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;
export type CoverColor = (typeof COVER_COLORS)[number];
export const coverColorSchema = z.enum(COVER_COLORS);

// Image MIMEs allowed as a cover. Source of truth: ATTACHMENT_ALLOWED_MIME
// (attachment.schema.ts) which intentionally excludes SVG. Duplicated here to
// keep card.schema self-contained (no cross-schema import).
export const COVER_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

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
  coverColor: coverColorSchema.nullable().optional(),
  coverAttachmentId: z.string().nullable().optional(),
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

// Resolved cover in the card payload: tagged union so the frontend renders
// without re-deriving the case; the image downloadUrl is resolved server-side.
export const cardCoverSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("color"), color: coverColorSchema }),
  z.object({
    type: z.literal("image"),
    attachmentId: z.string(),
    downloadUrl: z.string(),
  }),
]);
export type CardCover = z.infer<typeof cardCoverSchema>;

export const cardSchema = z.object({
  id: z.string(),
  columnId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  position: z.number(),
  dueAt: z.date().nullable(),
  reminderMinutes: z.number().nullable(),
  isOverdue: z.boolean(),
  cover: cardCoverSchema.nullable(),
  labels: z.array(labelSchema),
  assignees: z.array(assigneeSchema),
  checklistProgress: checklistProgressSchema,
  commentCount: z.number(),
  attachmentCount: z.number(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Card = z.infer<typeof cardSchema>;
