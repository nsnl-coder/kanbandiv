import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileMigrationProvider, Migrator } from "kysely";
import { appDb } from "../db/index.js";

const migrationFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

const migrator = new Migrator({
  db: appDb,
  provider: new FileMigrationProvider({ fs, path, migrationFolder }),
});

const { error, results } = await migrator.migrateToLatest();
for (const r of results ?? []) {
  console.log(`${r.status}: ${r.migrationName}`);
}
if (error) {
  console.error("Migration failed:", error);
  await appDb.destroy();
  process.exit(1);
}
console.log("Migrations applied.");
await appDb.destroy();
