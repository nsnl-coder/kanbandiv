// Pre-seeded test accounts for live-domain e2e. Credentials come from env
// (set per tier on the VPS, see run-e2e.sh). The accounts must already exist in
// the target environment's DB; tests never seed or reset the DB.

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set (e2e test account env)`);
  return v;
}

/** Regular (non-admin) test user. */
export const user = () => ({
  email: need("E2E_USER_EMAIL"),
  password: need("E2E_USER_PASSWORD"),
});

/** Admin/superuser test user (lands in /admin). */
export const admin = () => ({
  email: need("E2E_ADMIN_EMAIL"),
  password: need("E2E_ADMIN_PASSWORD"),
});

/** Dedicated account for the forgot-password flow (its password drifts each run;
 *  fine, since forgot only needs the email). */
export const resetEmail = () => need("E2E_RESET_EMAIL");

/** A fresh, unique email for sign-up/verify flows. Mailtrap sandbox catches all
 *  outgoing mail regardless of recipient, so any address works. */
export const freshEmail = (tag = "signup") =>
  `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
