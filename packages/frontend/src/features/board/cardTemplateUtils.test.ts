import { describe, expect, it } from "vitest";
import type { Card, Checklist } from "shared";
import { cardToTemplatePayload, emptyTemplatePayload } from "./cardTemplateUtils";

function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "k1",
    columnId: "c1",
    title: "Card",
    description: "desc",
    position: 0,
    dueAt: null,
    reminderMinutes: null,
    isOverdue: false,
    cover: null,
    labels: [
      { id: "l1", boardId: "b1", name: "Bug", color: "#eb5a46", createdAt: new Date(), updatedAt: new Date() },
      { id: "l2", boardId: "b1", name: "UI", color: "#61bd4f", createdAt: new Date(), updatedAt: new Date() },
    ],
    assignees: [],
    checklistProgress: { done: 0, total: 0 },
    commentCount: 0,
    attachmentCount: 0,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeChecklist(over: Partial<Checklist> = {}): Checklist {
  return {
    id: "cl1",
    cardId: "k1",
    title: "Steps",
    position: 0,
    items: [
      { id: "i1", checklistId: "cl1", text: "one", isDone: false, position: 0, createdAt: new Date(), updatedAt: new Date() },
      { id: "i2", checklistId: "cl1", text: "  ", isDone: false, position: 1, createdAt: new Date(), updatedAt: new Date() },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe("emptyTemplatePayload", () => {
  it("returns the default shape", () => {
    expect(emptyTemplatePayload()).toEqual({
      description: null,
      coverColor: null,
      labelIds: [],
      checklists: [],
    });
  });
});

describe("cardToTemplatePayload", () => {
  it("maps labels, description, checklists; drops empty item text", () => {
    const payload = cardToTemplatePayload(makeCard(), [makeChecklist()]);
    expect(payload.labelIds).toEqual(["l1", "l2"]);
    expect(payload.description).toBe("desc");
    expect(payload.checklists).toEqual([{ title: "Steps", items: ["one"] }]);
  });

  it("extracts only the color cover case", () => {
    const colorCard = makeCard({ cover: { type: "color", color: "blue" } });
    expect(cardToTemplatePayload(colorCard, []).coverColor).toBe("blue");
  });

  it("maps an image cover to null", () => {
    const imageCard = makeCard({
      cover: { type: "image", attachmentId: "a1", downloadUrl: "http://x/i.png" },
    });
    expect(cardToTemplatePayload(imageCard, []).coverColor).toBeNull();
  });

  it("handles an empty checklist list", () => {
    expect(cardToTemplatePayload(makeCard(), []).checklists).toEqual([]);
  });
});
