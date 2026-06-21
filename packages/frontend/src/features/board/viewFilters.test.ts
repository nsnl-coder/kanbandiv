import { describe, expect, it } from "vitest";
import type { Card, Label } from "shared";
import { cardMatchesDue, filterCards, type CardFilter } from "./utils";
import { toConfig, fromConfig } from "./boardView";

type TestCard = Pick<Card, "labels" | "assignees" | "dueAt" | "isOverdue">;

const label = (id: string): Label => ({
  id,
  boardId: "b1",
  name: id,
  color: "#61bd4f",
  createdAt: new Date(),
  updatedAt: new Date(),
});

const card = (over: Partial<TestCard> = {}): TestCard => ({
  labels: [],
  assignees: [],
  dueAt: null,
  isOverdue: false,
  ...over,
});

describe("cardMatchesDue", () => {
  it("null filter passes everything", () => {
    expect(cardMatchesDue(card(), null)).toBe(true);
    expect(cardMatchesDue(card({ dueAt: new Date() }), null)).toBe(true);
  });
  it("has_due only matches carded-due", () => {
    expect(cardMatchesDue(card({ dueAt: new Date() }), "has_due")).toBe(true);
    expect(cardMatchesDue(card({ dueAt: null }), "has_due")).toBe(false);
  });
  it("overdue aligns with dueState", () => {
    expect(cardMatchesDue(card({ dueAt: new Date(Date.now() - 1000), isOverdue: true }), "overdue")).toBe(true);
    expect(cardMatchesDue(card({ dueAt: new Date(Date.now() + 1000), isOverdue: false }), "overdue")).toBe(false);
  });
  it("due_soon aligns with dueState soon window", () => {
    expect(cardMatchesDue(card({ dueAt: new Date(Date.now() + 60 * 60 * 1000) }), "due_soon")).toBe(true);
    expect(cardMatchesDue(card({ dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) }), "due_soon")).toBe(false);
  });
});

const baseFilter: CardFilter = {
  labelIds: [],
  assigneeIds: [],
  assignedToMe: false,
  due: null,
  currentUserId: "me",
};

describe("filterCards", () => {
  it("empty filter passes everything", () => {
    const cards = [card(), card({ dueAt: new Date() })];
    expect(filterCards(cards, baseFilter)).toHaveLength(2);
  });
  it("ANDs label + assignee + assigned-to-me + due", () => {
    const match = card({
      labels: [label("a")],
      assignees: [{ id: "me", email: "me@x.com" }],
      dueAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const miss = card({ labels: [label("a")] });
    const out = filterCards([match, miss], {
      ...baseFilter,
      labelIds: ["a"],
      assigneeIds: ["me"],
      assignedToMe: true,
      due: "due_soon",
    });
    expect(out).toEqual([match]);
  });
  it("label filter narrows", () => {
    const a = card({ labels: [label("a")] });
    const b = card({ labels: [label("b")] });
    expect(filterCards([a, b], { ...baseFilter, labelIds: ["a"] })).toEqual([a]);
  });
});

describe("toConfig / fromConfig round-trip", () => {
  it("state -> config -> state is identity", () => {
    const state = {
      labelFilter: ["l1"],
      assigneeFilter: ["u1"],
      assignedToMe: true,
      dueFilter: "overdue" as const,
      swimlaneBy: "assignee" as const,
    };
    expect(fromConfig(toConfig(state))).toEqual(state);
  });
  it("config field names match BoardViewConfig", () => {
    const config = toConfig({
      labelFilter: ["l1"],
      assigneeFilter: ["u1"],
      assignedToMe: false,
      dueFilter: null,
      swimlaneBy: null,
    });
    expect(config).toEqual({
      labelIds: ["l1"],
      assigneeIds: ["u1"],
      assignedToMe: false,
      due: null,
      swimlaneBy: null,
    });
  });
});
