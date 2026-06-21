import { describe, it, expect } from "vitest";
import { NotificationType, type Notification } from "shared";
import { describeNotification } from "./describe";

function make(type: string, over: Partial<Notification["payload"]> = {}): Notification {
  return {
    id: "n1",
    type,
    payload: { boardId: "b1", cardId: "k1", actorHandle: "alice", title: "Task", ...over },
    readAt: null,
    createdAt: new Date(),
  };
}

describe("describeNotification", () => {
  it("produces a non-empty line + icon for every NotificationType", () => {
    for (const type of Object.values(NotificationType)) {
      const { icon, text } = describeNotification(make(type));
      expect(text.length).toBeGreaterThan(0);
      expect(icon).toBeTruthy();
    }
  });

  it("MENTION names the actor and title", () => {
    expect(describeNotification(make(NotificationType.MENTION)).text).toBe(
      'alice mentioned you on "Task"',
    );
  });

  it("CARD_ASSIGNED names the actor and title", () => {
    expect(describeNotification(make(NotificationType.CARD_ASSIGNED)).text).toBe(
      'alice assigned you to "Task"',
    );
  });

  it("CARD_DUE_SOON omits the actor", () => {
    expect(
      describeNotification(make(NotificationType.CARD_DUE_SOON, { actorHandle: null })).text,
    ).toBe('"Task" is due soon');
  });

  it("an unknown type hits the default without throwing", () => {
    expect(() => describeNotification(make("FUTURE_TYPE"))).not.toThrow();
    expect(describeNotification(make("FUTURE_TYPE")).text.length).toBeGreaterThan(0);
  });
});
