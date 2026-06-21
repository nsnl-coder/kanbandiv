import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { AssigneeError } from "shared";
import { assigneeErrorMessage } from "./assigneeErrors";

describe("assigneeErrorMessage", () => {
  it("maps every AssigneeError code to copy", () => {
    for (const code of Object.values(AssigneeError)) {
      const msg = assigneeErrorMessage(new TRPCClientError(code));
      expect(msg).not.toBe("Something went wrong. Please try again.");
    }
  });

  it("falls back for unknown errors", () => {
    expect(assigneeErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
