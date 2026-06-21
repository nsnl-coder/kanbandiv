import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { AttachmentError } from "shared";
import { attachmentErrorMessage } from "./attachmentErrors";

const FALLBACK = "Something went wrong. Please try again.";

describe("attachmentErrorMessage", () => {
  it("maps every code (tRPC error object) to copy", () => {
    for (const code of Object.values(AttachmentError)) {
      expect(attachmentErrorMessage(new TRPCClientError(code))).not.toBe(FALLBACK);
    }
  });

  it("maps a raw code string (XHR body)", () => {
    expect(attachmentErrorMessage(AttachmentError.FILE_TOO_LARGE)).toBe("That file is too large.");
  });

  it("falls back for unknown codes", () => {
    expect(attachmentErrorMessage("NOPE")).toBe(FALLBACK);
    expect(attachmentErrorMessage(new Error("boom"))).toBe(FALLBACK);
  });
});
