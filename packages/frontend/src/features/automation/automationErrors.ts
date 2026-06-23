import { TRPCClientError } from "@trpc/client";
import { AutomationError, type AutomationErrorValue } from "shared";

const MESSAGES: Record<AutomationErrorValue, string> = {
  [AutomationError.RULE_NOT_FOUND]: "That rule no longer exists.",
  [AutomationError.BOARD_NOT_FOUND]: "That board no longer exists.",
  [AutomationError.COLUMN_NOT_FOUND]: "That column no longer exists.",
};

export function automationErrorMessage(err: unknown): string {
  if (err instanceof TRPCClientError) {
    const msg = err.message;
    if (msg && msg in MESSAGES) return MESSAGES[msg as AutomationErrorValue];
    if (msg === "FORBIDDEN") return "You do not have permission to do that.";
  }
  return "Something went wrong. Please try again.";
}
