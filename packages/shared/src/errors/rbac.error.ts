export const RbacError = {
  FORBIDDEN: "FORBIDDEN",
  ROLE_NOT_FOUND: "ROLE_NOT_FOUND",
  ROLE_NAME_TAKEN: "ROLE_NAME_TAKEN",
  UNKNOWN_PERMISSION: "UNKNOWN_PERMISSION",
} as const;
export type RbacError = (typeof RbacError)[keyof typeof RbacError];
