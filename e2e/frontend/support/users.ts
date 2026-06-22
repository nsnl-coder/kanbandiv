import { TEST_USERS } from "shared";

// Test accounts for live-domain e2e. The account list is the shared single
// source of truth (packages/shared/test-user.ts), seeded by the backend
// seedTestUsers script. Only the shared password is secret (E2E_PASSWORD); the
// admin (super admin) creds come from env. The Mailtrap sandbox catches their
// mail regardless of address.

// Destructive tests (register new users / change a password) leave persistent
// state the API can't undo, so they run on dev only. Prod sets this false.
export const allowDestructive = process.env.E2E_ALLOW_DESTRUCTIVE === "true";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set (e2e env)`);
  return v;
}

const sharedPassword = () => need("E2E_PASSWORD");
const emailOfKind = (kind: "user" | "reset") => {
  const u = TEST_USERS.find((t) => t.kind === kind);
  if (!u) throw new Error(`no test user of kind "${kind}" in shared TEST_USERS`);
  return u.email;
};

/** Primary regular (non-admin) test user. */
export const user = () => ({ email: emailOfKind("user"), password: sharedPassword() });

/** Dedicated forgot-password account; password drifts, so only the email matters. */
export const resetEmail = () => emailOfKind("reset");

/** Admin = the singleton super admin (DB allows only one superuser), so its
 *  credentials come from env, not the code list above. */
export const admin = () => ({
  email: need("E2E_ADMIN_EMAIL"),
  password: need("E2E_ADMIN_PASSWORD"),
});

/** A fresh, unique email for sign-up/verify flows. */
export const freshEmail = (tag = "signup") =>
  `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
