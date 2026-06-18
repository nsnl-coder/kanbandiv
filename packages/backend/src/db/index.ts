import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { env } from "../config/env.config.js";
import type { Database } from "./types.js";

export type AppDb = Kysely<Database>;

export const appDb: AppDb = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: env.DATABASE_URL }),
  }),
});
