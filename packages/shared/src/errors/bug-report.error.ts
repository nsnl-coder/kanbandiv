export const BugReportError = {
  // Unknown id OR not the caller's report and the caller is not an admin
  // (same message — no existence leak).
  NOT_FOUND: "NOT_FOUND",
  // Update carried no changed field.
  NO_FIELDS: "NO_FIELDS",
} as const;
export type BugReportError = (typeof BugReportError)[keyof typeof BugReportError];
