import { describe, it, expect } from "vitest";
import { ActivityType, type Activity } from "shared";
import { describeActivity } from "./activity";

function act(type: string, meta: Activity["meta"] = {}): Activity {
  return {
    id: "a1",
    boardId: "b1",
    cardId: "k1",
    type,
    meta,
    actor: { id: "u1", handle: "alice" },
    createdAt: new Date(),
  };
}

describe("describeActivity", () => {
  it("produces a non-empty sentence and an icon for every ActivityType", () => {
    for (const type of Object.values(ActivityType)) {
      const { icon, text } = describeActivity(act(type), "card");
      expect(text.length).toBeGreaterThan(0);
      expect(icon).toBeTypeOf("object");
    }
  });

  it("falls back to a generic line for an unknown type without throwing", () => {
    const { text } = describeActivity(act("SOMETHING_NEW"), "card");
    expect(text).toBe("made a change");
  });

  it("renders representative phrasing", () => {
    expect(describeActivity(act(ActivityType.CARD_RENAMED, { from: "A", to: "B" })).text).toBe(
      'renamed from "A" to "B"',
    );
    expect(
      describeActivity(act(ActivityType.CARD_MOVED, { fromColumn: "To Do", toColumn: "Done" }))
        .text,
    ).toContain("from To Do to Done");
    expect(describeActivity(act(ActivityType.LABEL_ATTACHED, { labelName: "Bug" })).text).toContain(
      "added label Bug",
    );
    expect(
      describeActivity(act(ActivityType.ASSIGNEE_ASSIGNED, { targetHandle: "alice" })).text,
    ).toContain("assigned alice");
    expect(
      describeActivity(act(ActivityType.DUE_DATE_SET, { dueAt: new Date("2026-01-02T03:04:00") }))
        .text,
    ).toContain("set due date to");
    expect(
      describeActivity(act(ActivityType.COMMENT_ADDED, { snippet: "hi" })).text,
    ).toBe('commented: "hi"');
    expect(
      describeActivity(
        act(ActivityType.MEMBER_GRANTED, { targetHandle: "bob", permission: "edit" }),
      ).text,
    ).toBe("granted bob edit access");
  });

  it("scope=card omits the card name; scope=board includes it", () => {
    const a = act(ActivityType.CARD_MOVED, {
      cardTitle: "Login bug",
      fromColumn: "To Do",
      toColumn: "Done",
    });
    const card = describeActivity(a, "card").text;
    const board = describeActivity(a, "board").text;
    expect(card).not.toContain("Login bug");
    expect(board).toContain("Login bug");
  });
});
