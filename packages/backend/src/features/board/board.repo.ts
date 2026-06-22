import type { Kysely } from "kysely";
import type { ProjectPermission } from "shared";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export function createBoard(
  db: Db,
  input: {
    projectId: string;
    ownerId: string;
    name: string;
    description: string | null;
    color: string;
  },
) {
  return db
    .insertInto("boards")
    .values({
      project_id: input.projectId,
      owner_id: input.ownerId,
      name: input.name,
      description: input.description,
      color: input.color,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findBoardById(db: Db, id: string) {
  return db
    .selectFrom("boards")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export function listBoardsForProject(db: Db, projectId: string) {
  return db
    .selectFrom("boards")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("archived_at", "is", null)
    .orderBy("position", "asc")
    .execute();
}

// Sibling positions for a project's active boards, in sidebar order. Used to
// compute a fractional position for a drag-reorder/move.
export function listBoardPositions(db: Db, projectId: string) {
  return db
    .selectFrom("boards")
    .select(["id", "position"])
    .where("project_id", "=", projectId)
    .where("archived_at", "is", null)
    .orderBy("position", "asc")
    .execute();
}

export function setBoardPosition(
  db: Db,
  id: string,
  projectId: string,
  position: number,
) {
  return db
    .updateTable("boards")
    .set({ project_id: projectId, position })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function listArchivedBoardsForProject(db: Db, projectId: string) {
  return db
    .selectFrom("boards")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("archived_at", "is not", null)
    .orderBy("archived_at", "desc")
    .execute();
}

export function setBoardArchived(db: Db, id: string, at: Date | null) {
  return db
    .updateTable("boards")
    .set({ archived_at: at, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function updateBoard(
  db: Db,
  id: string,
  patch: { name?: string; description?: string | null; color?: string },
) {
  return db
    .updateTable("boards")
    .set({ ...patch, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function deleteBoard(db: Db, id: string) {
  return db.deleteFrom("boards").where("id", "=", id).execute();
}

// --- nested data ---

export function listColumnsForBoard(db: Db, boardId: string) {
  return db
    .selectFrom("columns")
    .selectAll()
    .where("board_id", "=", boardId)
    .where("archived_at", "is", null)
    .orderBy("position", "asc")
    .execute();
}

export function listCardsForBoard(db: Db, boardId: string) {
  return db
    .selectFrom("cards")
    .innerJoin("columns", "columns.id", "cards.column_id")
    .select([
      "cards.id as id",
      "cards.column_id as column_id",
      "cards.title as title",
      "cards.description as description",
      "cards.position as position",
      "cards.due_at as due_at",
      "cards.reminder_minutes as reminder_minutes",
      "cards.cover_color as cover_color",
      "cards.cover_attachment_id as cover_attachment_id",
      "cards.archived_at as archived_at",
      "cards.created_at as created_at",
      "cards.updated_at as updated_at",
    ])
    .where("columns.board_id", "=", boardId)
    .where("cards.archived_at", "is", null)
    .where("columns.archived_at", "is", null)
    .orderBy("cards.position", "asc")
    .execute();
}

// --- access ---

export async function findBoardAccess(
  db: Db,
  boardId: string,
  userId: string,
): Promise<ProjectPermission | undefined> {
  const row = await db
    .selectFrom("board_access")
    .select("permission")
    .where("board_id", "=", boardId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row?.permission;
}

export function listBoardAccess(db: Db, boardId: string) {
  return db
    .selectFrom("board_access")
    .innerJoin("users", "users.id", "board_access.user_id")
    .select([
      "board_access.user_id as user_id",
      "users.email as email",
      "board_access.permission as permission",
    ])
    .where("board_access.board_id", "=", boardId)
    .orderBy("users.email", "asc")
    .execute();
}

export async function upsertBoardAccess(
  db: Db,
  boardId: string,
  userId: string,
  permission: ProjectPermission,
): Promise<void> {
  await db
    .insertInto("board_access")
    .values({ board_id: boardId, user_id: userId, permission })
    .onConflict((oc) =>
      oc.columns(["board_id", "user_id"]).doUpdateSet({ permission }),
    )
    .execute();
}

export async function deleteBoardAccess(
  db: Db,
  boardId: string,
  userId: string,
): Promise<void> {
  await db
    .deleteFrom("board_access")
    .where("board_id", "=", boardId)
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

// --- project (for inheritance) ---

export function findProjectById(db: Db, id: string) {
  return db
    .selectFrom("projects")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function findProjectAccess(
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
