import { TRPCClientError } from "@trpc/client";
import { AssigneeError } from "shared";

const MESSAGES: Record<AssigneeError, string> = {
  [AssigneeError.FORBIDDEN]: "You do not have permission to do that.",
  [AssigneeError.CARD_NOT_FOUND]: "That card no longer exists.",
  [AssigneeError.BOARD_NOT_FOUND]: "That board no longer exists.",
  [AssigneeError.USER_NOT_FOUND]: "That user no longer exists.",
  [AssigneeError.NOT_BOARD_MEMBER]: "That user is not a member of this board.",
};

export function assigneeErrorMessage(err: unknown): string {
  if (err instanceof TRPCClientError) {
    const msg = err.message;
    if (msg && msg in MESSAGES) return MESSAGES[msg as AssigneeError];
  }
  return "Something went wrong. Please try again.";
}
