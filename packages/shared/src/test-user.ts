// Canonical e2e test accounts - the single source of truth shared by the seed
// script (packages/backend/src/scripts/seedTestUsers.script.ts, run it to
// provision them with is_test=true) and the e2e suite (e2e/frontend). Extend
// this list for multi-user flows (sharing, permissions, block user). The
// Mailtrap sandbox catches their mail regardless of address.
export interface TestUserDef {
  email: string;
  // "user"  = plain verified account.
  // "user2" = second plain account, for multi-user flows (sharing, permissions).
  // "reset" = used by the forgot-password flow (its password drifts each run).
  kind: "user" | "user2" | "reset";
}

export const TEST_USERS: readonly TestUserDef[] = [
  { email: "e2e@thatnails.com", kind: "user" },
  { email: "e2e-2@thatnails.com", kind: "user2" },
  { email: "e2eresetemail@thatnails.com", kind: "reset" },
];

export const TEST_USER_EMAILS = TEST_USERS.map((u) => u.email);

// Accounts on this domain are treated as e2e test accounts. The backend
// auto-flags freshly-registered ones is_test (non-prod only) so OTP flows skip
// the real email send; the seeded TEST_USERS use it too.
export const TEST_EMAIL_DOMAIN = "thatnails.com";
export const isTestEmailAddress = (email: string): boolean =>
  email.toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN}`);

// Deterministic OTPs the backend mints for is_test accounts instead of a random
// code (and then skips the email), so the e2e suite verifies / resets without
// polling Mailtrap. Lengths match VERIFY_OTP_LENGTH (6) / RESET_OTP_LENGTH (8);
// values differ from the wrong-code inputs specs submit (999999 / 00000000).
export const TEST_OTP_VERIFY = "123456";
export const TEST_OTP_RESET = "12345678";
