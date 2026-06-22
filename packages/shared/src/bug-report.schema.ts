import { z } from "zod";

export const BugSeverity = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
} as const;
export type BugSeverityValue = (typeof BugSeverity)[keyof typeof BugSeverity];

export const BugStatus = {
  OPEN: "open",
  IN_PROGRESS: "in_progress",
  RESOLVED: "resolved",
  CLOSED: "closed",
} as const;
export type BugStatusValue = (typeof BugStatus)[keyof typeof BugStatus];

export const severityEnum = z.enum(
  Object.values(BugSeverity) as [BugSeverityValue, ...BugSeverityValue[]],
);
export const statusEnum = z.enum(
  Object.values(BugStatus) as [BugStatusValue, ...BugStatusValue[]],
);

export const submitBugReportInput = z.object({
  title: z.string().min(3).max(140),
  description: z.string().min(5).max(5000),
  severity: severityEnum.default("medium"),
  pageUrl: z.string().max(2048).optional(),
});
export type SubmitBugReportInput = z.infer<typeof submitBugReportInput>;

export const listMyBugReportsInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
});
export type ListMyBugReportsInput = z.infer<typeof listMyBugReportsInput>;

export const listBugReportsInput = z.object({
  status: statusEnum.optional(),
  severity: severityEnum.optional(),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
});
export type ListBugReportsInput = z.infer<typeof listBugReportsInput>;

export const getBugReportInput = z.object({ id: z.string() });
export type GetBugReportInput = z.infer<typeof getBugReportInput>;

export const deleteBugReportInput = z.object({ id: z.string() });
export type DeleteBugReportInput = z.infer<typeof deleteBugReportInput>;

export const updateBugReportInput = z
  .object({
    id: z.string(),
    status: statusEnum.optional(),
    severity: severityEnum.optional(),
    resolution: z.string().max(5000).nullable().optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.severity !== undefined ||
      v.resolution !== undefined,
    { message: "NO_FIELDS" },
  );
export type UpdateBugReportInput = z.infer<typeof updateBugReportInput>;

export const bugReportSchema = z.object({
  id: z.string(),
  reporterId: z.string().nullable(),
  reporterEmail: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  severity: severityEnum,
  status: statusEnum,
  pageUrl: z.string().nullable(),
  userAgent: z.string().nullable(),
  resolution: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type BugReport = z.infer<typeof bugReportSchema>;

export const bugReportPageSchema = z.object({
  items: z.array(bugReportSchema),
  nextOffset: z.number().nullable(),
});
export type BugReportPage = z.infer<typeof bugReportPageSchema>;

// Attachments reuse the card-attachment storage limits + allowed mime list
// (ATTACHMENT_MAX_BYTES / ATTACHMENT_ALLOWED_MIME from attachment.schema).
export const bugReportAttachmentSchema = z.object({
  id: z.string(),
  bugReportId: z.string(),
  uploaderId: z.string().nullable(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.date(),
  downloadUrl: z.string(),
});
export type BugReportAttachment = z.infer<typeof bugReportAttachmentSchema>;

export const listBugReportAttachmentsInput = z.object({ bugReportId: z.string() });
export type ListBugReportAttachmentsInput = z.infer<typeof listBugReportAttachmentsInput>;

export const deleteBugReportAttachmentInput = z.object({ id: z.string() });
export type DeleteBugReportAttachmentInput = z.infer<typeof deleteBugReportAttachmentInput>;
