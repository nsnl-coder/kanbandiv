import { TRPCClientError } from "@trpc/client";
import { CardTemplateError } from "shared";

const MESSAGES: Record<CardTemplateError, string> = {
  [CardTemplateError.FORBIDDEN]: "You do not have permission to do that.",
  [CardTemplateError.TEMPLATE_NOT_FOUND]: "That template no longer exists.",
  [CardTemplateError.BOARD_NOT_FOUND]: "That board no longer exists.",
  [CardTemplateError.COLUMN_NOT_FOUND]: "That column no longer exists.",
  [CardTemplateError.INVALID_TARGET]: "That column belongs to another board.",
};

export function cardTemplateErrorMessage(err: unknown): string {
  if (err instanceof TRPCClientError) {
    const msg = err.message;
    if (msg && msg in MESSAGES) return MESSAGES[msg as CardTemplateError];
  }
  return "Something went wrong. Please try again.";
}
