import type { Kysely } from "kysely";
import type {
  ListProjectsInput,
  ProjectPermission,
  ProjectVisibility,
} from "shared";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export function createProject(
  db: Db,
  input: {
    ownerId: string;
    name: string;
    description: string | null;
    color: string;
    visibility: ProjectVisibility;
  },
) {
  return db
    .insertInto("projects")
    .values({
      owner_id: input.ownerId,
      name: input.name,
      description: input.description,
      color: input.color,
      visibility: input.visibility,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findProjectById(db: Db, id: string) {
  return db
    .selectFrom("projects")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

// Projects the user owns or has an explicit grant on. Public-but-not-shared
// projects are reachable by direct id, not auto-listed.
export function listProjectsForUser(
  db: Db,
  userId: string,
  opts: ListProjectsInput,
) {
  let q = db
    .selectFrom("projects")
    .leftJoin("project_access", (j) =>
      j
        .onRef("project_access.project_id", "=", "projects.id")
        .on("project_access.user_id", "=", userId),
    )
    // Projects holding a board the user has a direct grant on (1 row per project).
    .leftJoin(
      (eb) =>
        eb
          .selectFrom("board_access")
          .innerJoin("boards", "boards.id", "board_access.board_id")
          .where("board_access.user_id", "=", userId)
          .select("boards.project_id as project_id")
          .distinct()
          .as("board_shared"),
      (j) => j.onRef("board_shared.project_id", "=", "projects.id"),
    )
    .select([
      "projects.id as id",
      "projects.owner_id as owner_id",
      "projects.name as name",
      "projects.description as description",
      "projects.color as color",
      "projects.visibility as visibility",
      "projects.position as position",
      "projects.created_at as created_at",
      "projects.updated_at as updated_at",
      "project_access.permission as access_permission",
    ])
    .orderBy("projects.position", "asc")
    .limit(opts.limit)
    .offset(opts.offset);

  if (opts.filter === "owned") {
    q = q.where("projects.owner_id", "=", userId);
  } else if (opts.filter === "shared") {
    // Shared = a direct project grant OR a grant on any board inside it (so a
    // board shared with the user surfaces its parent project in the sidebar).
    q = q
      .where("projects.owner_id", "!=", userId)
      .where((eb) =>
        eb.or([
          eb("project_access.permission", "is not", null),
          eb("board_shared.project_id", "is not", null),
        ]),
      );
  } else {
    q = q.where((eb) =>
      eb.or([
        eb("projects.owner_id", "=", userId),
        eb("project_access.permission", "is not", null),
      ]),
    );
  }

  if (opts.search) {
    q = q.where("projects.name", "ilike", `%${opts.search}%`);
  }
  return q.execute();
}

export function updateProject(
  db: Db,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    color?: string;
    visibility?: ProjectVisibility;
  },
) {
  return db
    .updateTable("projects")
    .set({ ...patch, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function deleteProject(db: Db, id: string) {
  return db.deleteFrom("projects").where("id", "=", id).execute();
}

// Sibling positions for a user's owned projects, in sidebar order. Used to
// compute a fractional position for a drag-reorder.
export function listProjectPositions(db: Db, ownerId: string) {
  return db
    .selectFrom("projects")
    .select(["id", "position"])
    .where("owner_id", "=", ownerId)
    .orderBy("position", "asc")
    .execute();
}

export function setProjectPosition(db: Db, id: string, position: number) {
  return db
    .updateTable("projects")
    .set({ position })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

// --- per-user ordering (shared-with-me list) ---

export function listUserOrder(db: Db, userId: string) {
  return db
    .selectFrom("project_user_order")
    .select(["project_id", "position"])
    .where("user_id", "=", userId)
    .execute();
}

export async function setUserProjectPosition(
  db: Db,
  userId: string,
  projectId: string,
  position: number,
): Promise<void> {
  await db
    .insertInto("project_user_order")
    .values({ user_id: userId, project_id: projectId, position })
    .onConflict((oc) =>
      oc
        .columns(["user_id", "project_id"])
        .doUpdateSet({ position, updated_at: new Date() }),
    )
    .execute();
}

// --- access ---

export async function findAccess(
  db: Db,
  projectId: string,
  userId: string,
): Promise<ProjectPermission | undefined> {
  const row = await db
    .selectFrom("project_access")
    .select("permission")
    .where("project_id", "=", projectId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row?.permission;
}

export function listAccess(db: Db, projectId: string) {
  return db
    .selectFrom("project_access")
    .innerJoin("users", "users.id", "project_access.user_id")
    .select([
      "project_access.user_id as user_id",
      "users.email as email",
      "project_access.permission as permission",
    ])
    .where("project_access.project_id", "=", projectId)
    .orderBy("users.email", "asc")
    .execute();
}

export async function upsertAccess(
  db: Db,
  projectId: string,
  userId: string,
  permission: ProjectPermission,
): Promise<void> {
  await db
    .insertInto("project_access")
    .values({ project_id: projectId, user_id: userId, permission })
    .onConflict((oc) =>
      oc.columns(["project_id", "user_id"]).doUpdateSet({ permission }),
    )
    .execute();
}

export async function deleteAccess(
  db: Db,
  projectId: string,
  userId: string,
): Promise<void> {
  await db
    .deleteFrom("project_access")
    .where("project_id", "=", projectId)
    .where("user_id", "=", userId)
    .execute();
}

export function findUserByEmail(db: Db, email: string) {
  return db
    .selectFrom("users")
    .select(["id", "email"])
    .where("email", "=", email)
    .executeTakeFirst();
}

export function findUserById(db: Db, id: string) {
  return db
    .selectFrom("users")
    .select(["id", "email"])
    .where("id", "=", id)
    .executeTakeFirst();
}
