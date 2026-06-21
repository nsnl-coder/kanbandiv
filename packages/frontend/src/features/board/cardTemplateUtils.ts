import type { Card, Checklist, CardTemplatePayload } from "shared";

export function emptyTemplatePayload(): CardTemplatePayload {
  return { description: null, coverColor: null, labelIds: [], checklists: [] };
}

// Build a create-template payload from an open card. The card payload carries
// labels[] but NOT full checklists (only checklistProgress), so the caller must
// pass checklists fetched via trpc.checklists.listByCard. Cover is a tagged
// union; only the COLOR case maps (templates carry no image cover).
export function cardToTemplatePayload(
  card: Card,
  checklists: Checklist[],
): CardTemplatePayload {
  return {
    description: card.description ?? null,
    coverColor: card.cover?.type === "color" ? card.cover.color : null,
    labelIds: card.labels.map((l) => l.id),
    checklists: checklists.map((cl) => ({
      title: cl.title,
      items: cl.items.map((i) => i.text).filter((t) => t.trim().length > 0),
    })),
  };
}
