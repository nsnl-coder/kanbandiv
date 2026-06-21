import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { CardTemplateError } from "shared";
import { cardTemplateErrorMessage } from "./cardTemplateErrors";

describe("cardTemplateErrorMessage", () => {
  it("maps every CardTemplateError code to copy", () => {
    for (const code of Object.values(CardTemplateError)) {
      const msg = cardTemplateErrorMessage(new TRPCClientError(code));
      expect(msg).not.toBe("Something went wrong. Please try again.");
    }
  });

  it("falls back for unknown errors", () => {
    expect(cardTemplateErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
