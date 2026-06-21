export const NotificationError = {
  // The id is unknown OR belongs to another user — same message either way, no
  // cross-user existence leak.
  NOT_FOUND: "NOT_FOUND",
} as const;
export type NotificationError =
  (typeof NotificationError)[keyof typeof NotificationError];
