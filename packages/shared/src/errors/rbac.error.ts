export const RbacError = {
  // Caller is authenticated but lacks the required permission on the resource.
  FORBIDDEN: "FORBIDDEN",
  // Caller has no membership on the target project.
  NOT_A_MEMBER: "NOT_A_MEMBER",
  // Endpoint requires the global admin role.
  ADMIN_ONLY: "ADMIN_ONLY",
} as const;
export type RbacError = (typeof RbacError)[keyof typeof RbacError];
