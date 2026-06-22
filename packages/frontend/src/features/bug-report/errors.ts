import { TRPCClientError } from "@trpc/client";
import { AttachmentError, BugReportError } from "shared";

const MESSAGES: Record<BugReportError, string> = {
  [BugReportError.NOT_FOUND]: "That bug report no longer exists.",
  [BugReportError.NO_FIELDS]: "Change at least one field before saving.",
};

export function bugReportErrorMessage(err: unknown): string {
  if (err instanceof TRPCClientError) {
    const msg = err.message;
    if (msg && msg in MESSAGES) return MESSAGES[msg as BugReportError];
  }
  return "Something went wrong. Please try again.";
}

const ATTACHMENT_MESSAGES: Record<string, string> = {
  [AttachmentError.FORBIDDEN]: "You do not have permission to do that.",
  [AttachmentError.ATTACHMENT_NOT_FOUND]: "That attachment no longer exists.",
  [AttachmentError.FILE_TOO_LARGE]: "That file is too large.",
  [AttachmentError.UNSUPPORTED_TYPE]: "That file type is not allowed.",
  [AttachmentError.NO_FILE]: "Please choose a file to upload.",
  [AttachmentError.FILENAME_TOO_LONG]: "That file name is too long.",
  [AttachmentError.STORAGE_UNAVAILABLE]: "File storage is unavailable. Please try again later.",
  [AttachmentError.UNAUTHORIZED]: "Your session has expired. Please sign in again.",
};

// Accepts a tRPC error (message is the code) OR a raw code string from the
// upload XHR reject.
export function bugAttachmentErrorMessage(err: unknown): string {
  let code: string | undefined;
  if (err instanceof TRPCClientError) code = err.message;
  else if (typeof err === "string") code = err;
  if (code && code in ATTACHMENT_MESSAGES) return ATTACHMENT_MESSAGES[code];
  return "Something went wrong with the file. Please try again.";
}
