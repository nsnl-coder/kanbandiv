import { z } from "zod";
import { CARD_DESCRIPTION_MAX, coverColorSchema } from "./card.schema.js";
import { CHECKLIST_ITEM_TEXT_MAX, CHECKLIST_TITLE_MAX } from "./checklist.schema.js";

// MUST stay <= CARD_TITLE_MAX (200): instantiate sets the new card title =
// template.name, so the name is always a legal card title (no extra validation).
export const CARD_TEMPLATE_NAME_MAX = 100;
export const CARD_TEMPLATE_CHECKLIST_MAX = 20;
export const CARD_TEMPLATE_ITEMS_MAX = 50;
export const CARD_TEMPLATE_LABELS_MAX = 50;

export const cardTemplateChecklistSchema = z
  .object({
    title: z.string().min(1).max(CHECKLIST_TITLE_MAX),
    items: z
      .array(z.string().min(1).max(CHECKLIST_ITEM_TEXT_MAX))
      .max(CARD_TEMPLATE_ITEMS_MAX)
      .default([]),
  })
  .strict();
export type CardTemplateChecklist = z.infer<typeof cardTemplateChecklistSchema>;

// STRICT preset bag stored in the payload jsonb. Unknown keys are rejected so a
// malformed payload cannot corrupt the column. coverColor is the cover ENUM (not
// a free string) so the instantiate output (cardSchema) always validates.
export const cardTemplatePayloadSchema = z
  .object({
    description: z.string().max(CARD_DESCRIPTION_MAX).nullable().default(null),
    coverColor: coverColorSchema.nullable().default(null),
    labelIds: z.array(z.string()).max(CARD_TEMPLATE_LABELS_MAX).default([]),
    checklists: z
      .array(cardTemplateChecklistSchema)
      .max(CARD_TEMPLATE_CHECKLIST_MAX)
      .default([]),
  })
  .strict();
export type CardTemplatePayload = z.infer<typeof cardTemplatePayloadSchema>;

export const listCardTemplatesInput = z.object({ boardId: z.string() });
export type ListCardTemplatesInput = z.infer<typeof listCardTemplatesInput>;

export const createCardTemplateInput = z.object({
  boardId: z.string(),
  name: z.string().min(1).max(CARD_TEMPLATE_NAME_MAX),
  payload: cardTemplatePayloadSchema,
});
export type CreateCardTemplateInput = z.infer<typeof createCardTemplateInput>;

export const updateCardTemplateInput = z.object({
  name: z.string().min(1).max(CARD_TEMPLATE_NAME_MAX).optional(),
  payload: cardTemplatePayloadSchema.optional(),
});
export type UpdateCardTemplateInput = z.infer<typeof updateCardTemplateInput>;

export const instantiateCardTemplateInput = z.object({ columnId: z.string() });
export type InstantiateCardTemplateInput = z.infer<
  typeof instantiateCardTemplateInput
>;

export const cardTemplateSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  name: z.string(),
  payload: cardTemplatePayloadSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CardTemplate = z.infer<typeof cardTemplateSchema>;
