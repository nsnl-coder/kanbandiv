import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { BoardError } from "shared";
import { boardErrorMessage } from "./errors";

describe("boardErrorMessage", () => {
  it("maps every BoardError code to copy", () => {
    for (const code of Object.values(BoardError)) {
      const msg = boardErrorMessage(new TRPCClientError(code));
      expect(msg).not.toBe("Something went wrong. Please try again.");
    }
  });

  it("falls back for unknown errors", () => {
    expect(boardErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
