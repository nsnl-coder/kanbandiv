import {
  DEFAULT_BOARD_COLOR,
  type ProjectPermission,
} from "shared";
import {
  authedCaller,
  newTestDb,
  seedProject,
  seedUser,
  seedUserCaller,
  superuserCaller,
  type TestDb,
} from "../../project/test/helpers.js";

export {
  authedCaller,
  createCaller,
  makeContext,
  newTestDb,
  seedAccess,
  seedProject,
  seedUser,
  seedUserCaller,
  superuserCaller,
  type TestDb,
} from "../../project/test/helpers.js";

export interface SeedBoardOpts {
  projectId: string;
  ownerId: string;
  name?: string;
  description?: string | null;
  color?: string;
  archivedAt?: Date | null;
}

export async function seedBoard(db: TestDb, opts: SeedBoardOpts) {
  return db
    .insertInto("boards")
    .values({
      project_id: opts.projectId,
      owner_id: opts.ownerId,
      name: opts.name ?? "My Board",
      description: opts.description ?? null,
      color: opts.color ?? DEFAULT_BOARD_COLOR,
      archived_at: opts.archivedAt ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function seedBoardAccess(
  db: TestDb,
  boardId: string,
  userId: string,
  permission: ProjectPermission,
) {
  await db
    .insertInto("board_access")
    .values({ board_id: boardId, user_id: userId, permission })
    .execute();
}

export async function seedColumn(
  db: TestDb,
  opts: { boardId: string; name?: string; position: number; archivedAt?: Date | null },
) {
  return db
    .insertInto("columns")
    .values({
      board_id: opts.boardId,
      name: opts.name ?? "Todo",
      position: opts.position,
      archived_at: opts.archivedAt ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function seedCard(
  db: TestDb,
  opts: {
    columnId: string;
    title?: string;
    description?: string | null;
    position: number;
    archivedAt?: Date | null;
    dueAt?: Date | null;
    reminderMinutes?: number | null;
  },
) {
  return db
    .insertInto("cards")
    .values({
      column_id: opts.columnId,
      title: opts.title ?? "Task",
      description: opts.description ?? null,
      position: opts.position,
      archived_at: opts.archivedAt ?? null,
      due_at: opts.dueAt ?? null,
      reminder_minutes: opts.reminderMinutes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

// Convenience: owner + project + board in one call.
export async function seedOwnerBoard(db: TestDb, email = "owner@example.com") {
  const { user, caller } = await seedUserCaller(db, email);
  const project = await seedProject(db, { ownerId: user.id });
  const board = await seedBoard(db, {
    projectId: project.id,
    ownerId: user.id,
  });
  return { user, caller, project, board };
}
