import { TRPCClientError } from "@trpc/client";
import { BoardError } from "shared";

const MESSAGES: Record<BoardError, string> = {
  [BoardError.FORBIDDEN]: "You do not have permission to do that.",
  [BoardError.BOARD_NOT_FOUND]: "That board no longer exists.",
  [BoardError.COLUMN_NOT_FOUND]: "That column no longer exists.",
  [BoardError.CARD_NOT_FOUND]: "That card no longer exists.",
  [BoardError.USER_NOT_FOUND]: "No user found with that email.",
  [BoardError.CANNOT_GRANT_OWNER]: "The owner already has full access.",
  [BoardError.CANNOT_GRANT_SELF]: "You cannot grant access to yourself.",
  [BoardError.PROJECT_NOT_FOUND]: "That project no longer exists.",
  [BoardError.INVALID_MOVE]: "That move is not allowed.",
  [BoardError.INVALID_DUE_RANGE]: "That date range is not valid.",
  [BoardError.PARENT_ARCHIVED]: "Restore the parent first.",
};

export function boardErrorMessage(err: unknown): string {
  if (err instanceof TRPCClientError) {
    const msg = err.message;
    if (msg && msg in MESSAGES) return MESSAGES[msg as BoardError];
  }
  return "Something went wrong. Please try again.";
}
