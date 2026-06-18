export const AuthError = {
  EMAIL_TAKEN: "EMAIL_TAKEN",
  INVALID_OTP: "INVALID_OTP",
  ALREADY_VERIFIED: "ALREADY_VERIFIED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  INVALID_REFRESH_TOKEN: "INVALID_REFRESH_TOKEN",
  RATE_LIMITED: "RATE_LIMITED",
  // Access token missing/expired on a protected procedure. Distinct from the
  // domain UNAUTHORIZED errors above so the client refreshes only on this one.
  SESSION_EXPIRED: "SESSION_EXPIRED",
} as const;
export type AuthError = (typeof AuthError)[keyof typeof AuthError];
