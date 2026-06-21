export const InviteError = {
  // The invite id is unknown OR the caller does not own the scope.
  NOT_FOUND: "NOT_FOUND",
} as const;
export type InviteError = (typeof InviteError)[keyof typeof InviteError];
