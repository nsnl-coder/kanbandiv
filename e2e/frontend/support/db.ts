import bcrypt from "bcryptjs";
import { Pool } from "pg";

// Direct test-DB access for e2e: seed users/OTPs and reset state between tests.
// Points at the dedicated `trelloclone-test` database (DATABASE_URL from
// packages/backend/.env.test, loaded by playwright.config.ts). Never the dev DB.

const COST = Number(process.env.BCRYPT_COST ?? 12);

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL not set for e2e (load .env.test)");
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Wipe auth state between tests. CASCADE clears anything FK-referencing users
// (projects, boards, tokens, otps) so each test starts from a clean slate.
export async function resetDb(): Promise<void> {
  await db().query(
    "TRUNCATE TABLE users, refresh_tokens, otp_codes RESTART IDENTITY CASCADE",
  );
}

export interface SeedUserOpts {
  email: string;
  password?: string;
  verified?: boolean;
  superuser?: boolean;
}

export async function seedUser(opts: SeedUserOpts): Promise<{ id: string; email: string }> {
  const password = opts.password ?? "password123";
  const hash = await bcrypt.hash(password, COST);
  const { rows } = await db().query(
    `INSERT INTO users (email, password_hash, email_verified, is_superuser)
     VALUES ($1, $2, $3, $4) RETURNING id, email`,
    [opts.email.toLowerCase(), hash, opts.verified ?? true, opts.superuser ?? false],
  );
  return rows[0];
}

// Overwrite any pending OTP for a user with a known plaintext code, so the real
// verify/reset endpoints can be exercised without reading email. Mirrors the
// backend's hashing (bcrypt) and 10-minute expiry.
export async function setOtp(
  email: string,
  purpose: "verify_email" | "reset_password",
  code: string,
): Promise<void> {
  const hash = await bcrypt.hash(code, COST);
  await db().query(
    `DELETE FROM otp_codes WHERE purpose = $2 AND user_id =
       (SELECT id FROM users WHERE email = $1)`,
    [email.toLowerCase(), purpose],
  );
  await db().query(
    `INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at, attempts)
     SELECT id, $3, $2, now() + interval '10 minutes', 0
     FROM users WHERE email = $1`,
    [email.toLowerCase(), purpose, hash],
  );
}

// Insert N spent OTP rows in the resend window so the next real resend hits the
// cap (RESEND_CAP=3). Used to exercise the rate-limit path deterministically.
export async function fillOtpQuota(
  email: string,
  purpose: "verify_email" | "reset_password",
  n: number,
): Promise<void> {
  const hash = await bcrypt.hash("000000", COST);
  for (let i = 0; i < n; i++) {
    await db().query(
      `INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at, attempts)
       SELECT id, $3, $2, now() + interval '10 minutes', 0
       FROM users WHERE email = $1`,
      [email.toLowerCase(), purpose, hash],
    );
  }
}

export async function getUser(
  email: string,
): Promise<{ id: string; email: string; email_verified: boolean } | null> {
  const { rows } = await db().query(
    "SELECT id, email, email_verified FROM users WHERE email = $1",
    [email.toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function passwordMatches(email: string, password: string): Promise<boolean> {
  const { rows } = await db().query(
    "SELECT password_hash FROM users WHERE email = $1",
    [email.toLowerCase()],
  );
  if (!rows[0]) return false;
  return bcrypt.compare(password, rows[0].password_hash);
}
