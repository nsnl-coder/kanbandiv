import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load packages/backend/.env.test into process.env (test DB url, bcrypt cost,
// etc.) so both the setup script and the in-test pg pool target the test DB.
// Kept dependency-free (no dotenv) to avoid an extra install in this package.
//
// The file is the LOCAL source of truth. On the dev/prod VPS the e2e runner gets
// the same vars from compose `environment:` instead, so a missing file is fine -
// process.env already carries everything (we only fill gaps from the file).
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const ENV_FILE = path.join(repoRoot, "packages", "backend", ".env.test");

export function loadTestEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  const raw = fs.readFileSync(ENV_FILE, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    out[key] = val;
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return out;
}
