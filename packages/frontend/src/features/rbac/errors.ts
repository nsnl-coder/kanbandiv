import { TRPCClientError } from "@trpc/client";
import { RbacError } from "shared";

const MESSAGES: Record<RbacError, string> = {
  [RbacError.FORBIDDEN]: "You do not have permission to do that.",
  [RbacError.ROLE_NOT_FOUND]: "That role no longer exists.",
  [RbacError.ROLE_NAME_TAKEN]: "A role with that name already exists.",
  [RbacError.UNKNOWN_PERMISSION]: "One of the selected permissions is invalid.",
};

export function rbacErrorMessage(err: unknown): string {
  if (err instanceof TRPCClientError) {
    const msg = err.message;
    if (msg && msg in MESSAGES) return MESSAGES[msg as RbacError];
  }
  return "Something went wrong. Please try again.";
}
