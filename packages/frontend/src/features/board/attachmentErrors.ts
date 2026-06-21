import { TRPCClientError } from "@trpc/client";
import { AttachmentError } from "shared";

const MESSAGES: Record<AttachmentError, string> = {
  [AttachmentError.FORBIDDEN]: "You do not have permission to do that.",
  [AttachmentError.ATTACHMENT_NOT_FOUND]: "That attachment no longer exists.",
  [AttachmentError.CARD_NOT_FOUND]: "That card no longer exists.",
  [AttachmentError.FILE_TOO_LARGE]: "That file is too large.",
  [AttachmentError.UNSUPPORTED_TYPE]: "That file type is not allowed.",
  [AttachmentError.NO_FILE]: "Please choose a file to upload.",
  [AttachmentError.FILENAME_TOO_LONG]: "That file name is too long.",
  [AttachmentError.STORAGE_UNAVAILABLE]: "File storage is unavailable. Please try again later.",
  [AttachmentError.UNAUTHORIZED]: "Your session has expired. Please sign in again.",
};

// Accepts a tRPC error object (message is the error constant) OR a raw code
// string from the upload XHR JSON error body.
export function attachmentErrorMessage(err: unknown): string {
  let code: string | undefined;
  if (err instanceof TRPCClientError) code = err.message;
  else if (typeof err === "string") code = err;
  if (code && code in MESSAGES) return MESSAGES[code as AttachmentError];
  return "Something went wrong. Please try again.";
}
