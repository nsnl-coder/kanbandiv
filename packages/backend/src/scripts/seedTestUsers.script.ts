import bcrypt from "bcryptjs";
import { TEST_USERS } from "shared";
import { appDb } from "../db/index.js";
import { env } from "../config/env.config.js";

// Provision the e2e test accounts (idempotent): verified, non-superuser, and
// is_test=true so they bypass the auth rate limiter. Emails come from the shared
// TEST_USERS list; the shared password comes from E2E_PASSWORD. Run on each test
// environment after migrations:
//   tsx --env-file=.env.<tier> src/scripts/seedTestUsers.script.ts
const password = process.env.E2E_PASSWORD;
if (!password) {
  console.error("E2E_PASSWORD not set; cannot seed test users.");
  await appDb.destroy();
  process.exit(1);
}

const password_hash = await bcrypt.hash(password, env.BCRYPT_COST);

for (const u of TEST_USERS) {
  await appDb
    .insertInto("users")
    .values({
      email: u.email,
      password_hash,
      email_verified: true,
      is_superuser: false,
      is_test: true,
    })
    .onConflict((oc) =>
      oc.column("email").doUpdateSet({ password_hash, email_verified: true, is_test: true }),
    )
    .execute();
  console.log(`seeded test user: ${u.email}`);
}

await appDb.destroy();
