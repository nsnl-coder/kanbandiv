import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { BugReportError } from "shared";
import { bugReportErrorMessage } from "./errors";

describe("bugReportErrorMessage", () => {
  it("maps every BugReportError code to copy", () => {
    for (const code of Object.values(BugReportError)) {
      const msg = bugReportErrorMessage(new TRPCClientError(code));
      expect(msg).not.toBe("Something went wrong. Please try again.");
    }
  });

  it("falls back for unknown errors", () => {
    expect(bugReportErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
