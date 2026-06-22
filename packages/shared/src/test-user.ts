// Canonical e2e test accounts - the single source of truth shared by the seed
// script (packages/backend/src/scripts/seedTestUsers.script.ts, run it to
// provision them with is_test=true) and the e2e suite (e2e/frontend). Extend
// this list for multi-user flows (sharing, permissions, block user). The
// Mailtrap sandbox catches their mail regardless of address.
export interface TestUserDef {
  email: string;
  // "user"  = plain verified account.
  // "reset" = used by the forgot-password flow (its password drifts each run).
  kind: "user" | "reset";
}

export const TEST_USERS: readonly TestUserDef[] = [
  { email: "e2e@thatnails.com", kind: "user" },
  { email: "e2eresetemail@thatnails.com", kind: "reset" },
];

export const TEST_USER_EMAILS = TEST_USERS.map((u) => u.email);
