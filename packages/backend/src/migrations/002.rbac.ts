import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("roles")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", "text", (c) => c.notNull().unique())
    .addColumn("description", "text")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("role_permissions")
    .addColumn("role_id", "uuid", (c) =>
      c.notNull().references("roles.id").onDelete("cascade"),
    )
    .addColumn("permission", "text", (c) => c.notNull())
    .addPrimaryKeyConstraint("role_permissions_pkey", ["role_id", "permission"])
    .execute();

  await db.schema
    .createIndex("role_permissions_role_idx")
    .on("role_permissions")
    .column("role_id")
    .execute();

  await db.schema
    .alterTable("users")
    .addColumn("is_superuser", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();

  await db.schema
    .alterTable("users")
    .addColumn("role_id", "uuid", (c) =>
      c.references("roles.id").onDelete("set null"),
    )
    .execute();

  // Invariant: at most one superuser. A partial unique index over the boolean
  // expression only indexes true rows, so a second superuser violates it.
  await sql`CREATE UNIQUE INDEX users_one_superuser ON users ((is_superuser)) WHERE is_superuser`.execute(
    db,
  );

  await db.schema.alterTable("users").dropColumn("role").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS users_one_superuser`.execute(db);
  await db.schema
    .alterTable("users")
    .addColumn("role", "text", (c) => c.notNull().defaultTo("user"))
    .execute();
  // Drop the FK before the column so dependent-table drops below don't fail.
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_id_fkey`.execute(db);
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_id_fk`.execute(db);
  await db.schema.alterTable("users").dropColumn("role_id").execute();
  await db.schema.alterTable("users").dropColumn("is_superuser").execute();
  await db.schema.dropTable("role_permissions").ifExists().execute();
  await db.schema.dropTable("roles").ifExists().execute();
}
