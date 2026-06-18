import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Migration, type MigrationProvider, Migrator } from "kysely";
import { appDb } from "../db/index.js";

const migrationFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

// Windows-safe provider: import via file:// URL and skip test files.
const provider: MigrationProvider = {
  async getMigrations() {
    const files = await fs.readdir(migrationFolder);
    const migrations: Record<string, Migration> = {};
    for (const file of files.sort()) {
      if (!/\.(ts|js|mjs)$/.test(file) || /\.spec\./.test(file)) continue;
      const name = file.replace(/\.(ts|js|mjs)$/, "");
      migrations[name] = await import(
        pathToFileURL(path.join(migrationFolder, file)).href
      );
    }
    return migrations;
  },
};

const migrator = new Migrator({ db: appDb, provider });

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
