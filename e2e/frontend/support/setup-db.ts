import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { loadTestEnv } from "./env.js";

// One-shot pre-test reset: drop + recreate the public schema in trelloclone-test,
// then run backend migrations. Must run BEFORE the test backend boots (it seeds
// the super admin on startup, which needs the tables to exist).

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");

async function main() {
  loadTestEnv();
  const url = process.env.DATABASE_URL;
  if (!url || !/trelloclone-test/.test(url)) {
    throw new Error(`Refusing to reset non-test DB: ${url}`);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();
  console.log("[e2e] test schema reset");

  // Migrate using the inherited env (DATABASE_URL is already in process.env from
  // the file locally, or from compose `environment:` on the VPS) - no --env-file
  // so the same command works in both places.
  execSync("pnpm exec tsx src/scripts/migrate.script.ts", {
    cwd: path.join(repoRoot, "packages", "backend"),
    stdio: "inherit",
    env: process.env,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
