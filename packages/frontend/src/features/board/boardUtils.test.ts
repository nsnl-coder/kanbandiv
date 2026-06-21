import { describe, expect, it } from "vitest";
import {
  cardMatchesLabels,
  cardMatchesAssignees,
  cardAssignedToUser,
  assigneeDisplayName,
  assigneeInitials,
  assigneeColor,
  dueState,
  formatDueDate,
  renderMentions,
} from "./utils";
import type { Assignee } from "shared";
import type { Label } from "shared";

const label = (id: string): Label => ({
  id,
  boardId: "b1",
  name: id,
  color: "#61bd4f",
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("dueState", () => {
  it("returns none when no due date", () => {
    expect(dueState({ dueAt: null, isOverdue: false })).toBe("none");
  });
  it("returns overdue when flagged", () => {
    expect(dueState({ dueAt: new Date(Date.now() - 1000), isOverdue: true })).toBe("overdue");
  });
  it("returns soon when within a day", () => {
    expect(dueState({ dueAt: new Date(Date.now() + 60 * 60 * 1000), isOverdue: false })).toBe(
      "soon",
    );
  });
  it("returns upcoming when far in the future", () => {
    expect(
      dueState({ dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), isOverdue: false }),
    ).toBe("upcoming");
  });
});

describe("formatDueDate", () => {
  it("produces a non-empty string", () => {
    expect(formatDueDate(new Date("2030-01-02T10:30:00"))).toBeTruthy();
  });
});

describe("cardMatchesLabels", () => {
  it("matches when no filter", () => {
    expect(cardMatchesLabels({ labels: [] }, [])).toBe(true);
  });
  it("requires all selected labels present", () => {
    const card = { labels: [label("a"), label("b")] };
    expect(cardMatchesLabels(card, ["a"])).toBe(true);
    expect(cardMatchesLabels(card, ["a", "b"])).toBe(true);
    expect(cardMatchesLabels(card, ["a", "c"])).toBe(false);
  });
});

const assignee = (id: string, email: string): Assignee => ({ id, email });

describe("assigneeDisplayName / assigneeInitials", () => {
  it("derives the name from the email local-part", () => {
    expect(assigneeDisplayName("alice@example.com")).toBe("alice");
  });
  it("initials from a dotted local-part", () => {
    expect(assigneeInitials("john.doe@example.com")).toBe("JD");
  });
  it("initials from a single-token local-part", () => {
    expect(assigneeInitials("alice@example.com")).toBe("AL");
  });
  it("initials from a single-char local-part", () => {
    expect(assigneeInitials("a@example.com")).toBe("A");
  });
});

describe("assigneeColor", () => {
  it("is deterministic for the same id", () => {
    expect(assigneeColor("u1")).toBe(assigneeColor("u1"));
  });
});

describe("cardAssignedToUser", () => {
  it("matches when the user is an assignee", () => {
    const card = { assignees: [assignee("u1", "a@x.com")] };
    expect(cardAssignedToUser(card, "u1")).toBe(true);
    expect(cardAssignedToUser(card, "u2")).toBe(false);
  });
  it("is false when the user id is empty", () => {
    expect(cardAssignedToUser({ assignees: [assignee("u1", "a@x.com")] }, "")).toBe(false);
  });
});

describe("cardMatchesAssignees", () => {
  it("matches when no filter", () => {
    expect(cardMatchesAssignees({ assignees: [] }, [])).toBe(true);
  });
  it("OR-matches any selected assignee", () => {
    const card = { assignees: [assignee("u1", "a@x.com"), assignee("u2", "b@x.com")] };
    expect(cardMatchesAssignees(card, ["u1"])).toBe(true);
    expect(cardMatchesAssignees(card, ["u2", "u3"])).toBe(true);
    expect(cardMatchesAssignees(card, ["u3"])).toBe(false);
  });
});

describe("renderMentions", () => {
  it("flags mentions that match a known member", () => {
    const segs = renderMentions("hi @alice and @bob", [{ name: "alice" }]);
    const mentions = segs.filter((s) => s.isMention).map((s) => s.text);
    expect(mentions).toContain("@alice");
    expect(mentions).not.toContain("@bob");
  });
  it("returns plain text when no mentions", () => {
    const segs = renderMentions("just text", [{ name: "alice" }]);
    expect(segs).toEqual([{ text: "just text", isMention: false }]);
  });
});
