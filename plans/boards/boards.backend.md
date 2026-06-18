# Boards + Columns + Cards — Backend Plan

Hierarchy: **Board > Column > Card**. Drag ordering on columns and cards.
Access: a board belongs to a project. Effective board permission =
`max(inherited project permission, board's own grant)`. Boards also have their
own `board_access` table (mirrors `project_access`).

Mirror existing `features/project` patterns: `*.router.ts` / `*.service.ts` /
`*.repo.ts` + `test/<endpoint>.spec.ts`, Kysely, tRPC `protectedProcedure`,
Zod schemas from `shared`, OpenAPI `.meta`.

## Permission model

- RANK: `view=0, edit=1, owner=2` (reuse `ProjectPermission` enum values).
- Resolve board perm for a user:
  1. superuser -> `owner`
  2. project owner OR board `owner_id === user.id` -> `owner`
  3. board_access grant -> its permission
  4. inherited: project access grant (or public project) -> that permission
  5. else `null` (NOT_FOUND, do not leak existence)
- Columns/cards inherit the parent board's effective permission. Mutations
  need `edit`; read needs `view`; delete board / manage board access need
  `owner`.

## API endpoints

tRPC procedure -> OpenAPI method + path. All `protectedProcedure`.

### boards (`/boards`)
| Procedure            | Method | Path                          | Min perm | Notes |
|----------------------|--------|-------------------------------|----------|-------|
| `boards.list`        | GET    | `/boards?projectId=`          | view     | boards in a project |
| `boards.get`         | GET    | `/boards/{id}`                | view     | single board |
| `boards.getData`     | GET    | `/boards/{id}/data`           | view     | nested columns+cards |
| `boards.create`      | POST   | `/boards`                     | project edit | creator = board owner |
| `boards.update`      | PATCH  | `/boards/{id}`                | edit     | name/description/color |
| `boards.delete`      | DELETE | `/boards/{id}`                | owner    | cascades |
| `boards.accessList`  | GET    | `/boards/{id}/access`         | owner    | board grants |
| `boards.accessGrant` | PUT    | `/boards/{id}/access`         | owner    | email+permission |
| `boards.accessRevoke`| DELETE | `/boards/{id}/access/{userId}`| owner    | |

### columns (`/columns`)
| Procedure         | Method | Path                  | Min perm | Notes |
|-------------------|--------|-----------------------|----------|-------|
| `columns.create`  | POST   | `/columns`            | edit     | boardId, name; pos=max+1 |
| `columns.update`  | PATCH  | `/columns/{id}`       | edit     | name |
| `columns.delete`  | DELETE | `/columns/{id}`       | edit     | cascades cards |
| `columns.move`    | POST   | `/columns/{id}/move`  | edit     | beforeId/afterId -> position |

### cards (`/cards`)
| Procedure      | Method | Path               | Min perm | Notes |
|----------------|--------|--------------------|----------|-------|
| `cards.create` | POST   | `/cards`           | edit     | columnId, title; pos=max+1 |
| `cards.update` | PATCH  | `/cards/{id}`      | edit     | title/description |
| `cards.delete` | DELETE | `/cards/{id}`      | edit     | |
| `cards.move`   | POST   | `/cards/{id}/move` | edit     | toColumnId + beforeId/afterId |

## 1. Database (migrations + db types)

- [x] `migrations/004.board.ts` — `boards` table: `id uuid pk`,
  `project_id uuid fk projects.id cascade`, `owner_id uuid fk users.id cascade`,
  `name text notnull`, `description text null`, `color text notnull`,
  `created_at/updated_at timestamptz default now()`. Index on `project_id`.
- [x] same migration — `board_access` table: `board_id uuid fk cascade`,
  `user_id uuid fk cascade`, `permission text notnull`,
  pk `(board_id, user_id)`, index on `user_id`.
- [x] `migrations/005.column.ts` — `columns` table: `id uuid pk`,
  `board_id uuid fk boards.id cascade`, `name text notnull`,
  `position double precision notnull`, timestamps. Index on `board_id`.
- [x] `migrations/006.card.ts` — `cards` table: `id uuid pk`,
  `column_id uuid fk columns.id cascade`, `title text notnull`,
  `description text null`, `position double precision notnull`, timestamps.
  Index on `column_id`.
- [x] `db/types.ts` — add `BoardsTable`, `BoardAccessTable`, `ColumnsTable`,
  `CardsTable`; register in `Database` interface.
- [x] migration spec files (mirror `001.auth.spec.ts`) verifying up/down +
  cascade deletes (deleting a board removes its columns/cards/access).

Ordering: `position` is `double precision`. New item = `(maxPos + 1)`.
Move = midpoint between neighbours `(prev + next) / 2`; if no neighbour use
`next - 1` / `prev + 1`. (Cheap, no full reindex; good enough for v1.)

## 2. Shared schemas + errors (`packages/shared`)

- [x] `src/board.schema.ts` — constants (`BOARD_NAME_MIN/MAX`,
  `BOARD_DESCRIPTION_MAX`, `DEFAULT_BOARD_COLOR`); inputs
  `createBoardInput` (projectId, name, description?, color),
  `updateBoardInput`, `listBoardsInput` (projectId), board access inputs
  (reuse `grantAccessInput` shape: email + permission, + `revokeAccessInput`);
  outputs `boardSchema` (id, projectId, ownerId, name, description, color,
  myPermission, timestamps), `boardAccessEntrySchema`.
- [x] `src/column.schema.ts` — `createColumnInput` (boardId, name),
  `updateColumnInput` (name), `moveColumnInput` (id, beforeId?/afterId? or
  target position), `columnSchema`.
- [x] `src/card.schema.ts` — `createCardInput` (columnId, title, description?),
  `updateCardInput`, `moveCardInput` (id, toColumnId, beforeId?/afterId?),
  `cardSchema`.
- [x] `src/board.schema.ts` add `boardDataSchema` = board + `columns[]` each
  with `cards[]` (nested payload for the kanban view).
- [x] `src/errors/board.error.ts` — `BoardError`: `FORBIDDEN`,
  `BOARD_NOT_FOUND`, `COLUMN_NOT_FOUND`, `CARD_NOT_FOUND`, `USER_NOT_FOUND`,
  `CANNOT_GRANT_OWNER`, `CANNOT_GRANT_SELF`, `PROJECT_NOT_FOUND`.
- [x] `src/index.ts` — export the new schema + error modules.

## 3. Board feature (`features/board`)

- [x] `board.repo.ts` — `createBoard`, `findBoardById`, `listBoardsForProject`,
  `updateBoard`, `deleteBoard`; access: `findBoardAccess`, `listBoardAccess`,
  `upsertBoardAccess`, `deleteBoardAccess`, `findUserByEmail`. Plus
  `findProjectById` + `findProjectAccess` (read project for inheritance).
- [x] `board.service.ts` — `resolveBoardPermission` (the 5-step model above,
  loading the parent project), `loadBoardFor(min)`, `listBoards`, `getBoard`,
  `getBoardData` (nested columns+cards), `createBoard` (caller needs `edit` on
  the project; creator = owner of the board), `updateBoard` (edit),
  `deleteBoard` (owner), `listBoardAccess`/`grantBoardAccess`/
  `revokeBoardAccess` (owner).
- [x] `board.router.ts` — `list`, `get`, `getData`, `create`, `update`,
  `delete`, `accessList`, `accessGrant`, `accessRevoke` with OpenAPI meta
  under `/boards`.
- [x] register `boardsRouter` in `trpc/router.ts` as `boards`.

## 4. Column feature (`features/column`)

- [x] `column.repo.ts` — `createColumn`, `findColumnById`, `listByBoard`,
  `updateColumn`, `deleteColumn`, `maxPosition(boardId)`, neighbour lookups
  for move.
- [x] `column.service.ts` — load board via `column.board_id`, enforce board
  `edit` for mutations / `view` for reads; `createColumn`, `updateColumn`,
  `deleteColumn`, `moveColumn` (recompute position).
- [x] `column.router.ts` — `create`, `update`, `delete`, `move` under
  `/columns`; register as `columns`.

## 5. Card feature (`features/card`)

- [x] `card.repo.ts` — `createCard`, `findCardById`, `listByColumn`,
  `updateCard`, `deleteCard`, `maxPosition(columnId)`, neighbour lookups.
- [x] `card.service.ts` — resolve board through `card.column_id ->
  column.board_id`; enforce `edit`/`view`; `createCard`, `updateCard`,
  `deleteCard`, `moveCard` (validate target column on same board, recompute
  position).
- [x] `card.router.ts` — `create`, `update`, `delete`, `move` under `/cards`;
  register as `cards`.

## 6. Tests (pg-mem, mirror `features/project/test`)

Add `test/helpers.ts` per feature: `seedBoard`, `seedBoardAccess`,
`seedColumn`, `seedCard`, reuse `seedUser`/`seedProject`/`authedCaller`.

### Boards
- [x] create: project owner creates board -> becomes board owner.
- [x] create: project `edit`-grantee can create; `view`-only -> FORBIDDEN.
- [x] create: no project access -> NOT_FOUND (no leak).
- [x] list: returns boards in a project the caller can view; excludes others.
- [x] get/getData: returns nested columns+cards ordered by position.
- [x] update: edit-grantee can rename; view-only -> FORBIDDEN.
- [x] delete: board owner / project owner ok; edit-grantee -> FORBIDDEN.
- [x] inheritance: project `edit` grants board `edit` with no board_access row.
- [x] board_access overrides up (board `edit` to a project `view` user works).
- [x] superuser: full access without grants.
- [x] access grant/revoke: owner only; cannot grant owner/self; unknown email
  -> USER_NOT_FOUND.
- [x] auth: unauthenticated caller -> UNAUTHORIZED.

### Columns
- [x] create at end (position = max+1); list ordered.
- [x] move to start / middle / end yields correct order.
- [x] update/delete require board `edit`; view-only -> FORBIDDEN.
- [x] delete column cascades its cards.
- [x] column on a board the caller cannot view -> NOT_FOUND.

### Cards
- [x] create at end of column; list ordered.
- [x] move within same column reorders correctly.
- [x] move to another column on the same board updates `column_id` + position.
- [x] move to a column on a different board -> BAD_REQUEST.
- [x] update/delete require `edit`; view-only -> FORBIDDEN.
- [x] card under inaccessible board -> NOT_FOUND.

### Migrations
- [x] up creates all 4 tables + indexes; down drops them.
- [x] deleting a project cascades boards -> columns -> cards -> access.

## 7. Verify
- [x] `pnpm --filter shared build`
- [ ] `pnpm --filter backend migrate` (local) — not run (needs live Postgres); migrations auto-discovered by migrate.script.ts and verified via pg-mem migration spec.
- [x] `pnpm --filter backend test` green
- [ ] Swagger shows the new `/boards` `/columns` `/cards` routes — OpenAPI `.meta` added on every procedure; not visually confirmed against a running server.
