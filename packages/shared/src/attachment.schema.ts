import { z } from "zod";

export const ATTACHMENT_FILENAME_MAX = 255;
// Source of truth shared with the frontend (10 MB).
export const ATTACHMENT_MAX_BYTES = 10485760;

// SVG is intentionally excluded: served from the app origin it can execute
// script (stored XSS). Downloads are always served as attachments + nosniff.
export const ATTACHMENT_ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
] as const;

export const listAttachmentsInput = z.object({ cardId: z.string() });
export type ListAttachmentsInput = z.infer<typeof listAttachmentsInput>;

export const deleteAttachmentInput = z.object({ id: z.string() });
export type DeleteAttachmentInput = z.infer<typeof deleteAttachmentInput>;

export const attachmentSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  uploaderId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.date(),
  downloadUrl: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
