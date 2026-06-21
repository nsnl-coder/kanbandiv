# Attachments — Backend Plan

File uploads on cards, stored in MinIO. The codebase has no S3 SDK today
(backup shells out to `mc`, see `features/backup/backup.job.ts`); add the
`minio` npm client. Upload + download go through Express multipart routes (mirror
`features/sso/sso.http.ts` / `features/backup/backup.http.ts` for the
`Router` + plain-HTTP error shape), NOT tRPC — keeps same-origin cookie auth,
streams bytes, avoids exposing MinIO to the browser and avoids tRPC's JSON-only
body. Metadata `list` + `delete` are tRPC (mirror `features/card`). Permission
resolves through the card chain (`card.column_id -> column.board_id`) reusing the
board effective permission (`board.service.loadBoardFor`): board `view` to
list/download, `edit` to upload, uploader-or-board-`owner` to delete.

Mirror `features/card` for the tRPC parts; mirror `sso.http.ts`/`backup.http.ts`
for the Express parts. Reuse `loadBoardFor(db, user, id, min)` from
`board.service.ts` (signature is `(db, user, id, min)` — NOT `boardId`) for
permission and `findCardById`/`findColumnById` from `card.repo.ts` for the
card->board chain.

> IMPORTANT auth note (corrected): there is NO single shared "cookie verify"
> helper. `trpc/context.ts` only reads `access_token` and sets `userId` via
> `verifyAccessToken(token).sub` (from `auth.service.ts`). The real authz that
> the tRPC `protectedProcedure` applies lives in `trpc/trpc.ts`: it then loads
> the user (`findPublicUserById`), rejects unverified accounts
> (`email_verified`), and resolves `isSuperuser` (`findUserGlobalPerms`). The
> Express auth middleware MUST replicate ALL of this, not just `verifyAccessToken`,
> or it would accept tokens for deleted/unverified users and would not know
> `isSuperuser` (needed by `loadBoardFor`). `backup.http.ts` does NOT use the
> cookie at all (it verifies a signed `state` param); `sso.http.ts` reads
> `cookiesOf(req).access_token` then calls a domain helper. Model the new
> middleware on the trpc.ts flow, not on backup.http.ts.

> IMPORTANT CSRF note (corrected): `csrfGuard` in `index.ts` is NOT app-wide. It
> is applied ONLY to the `/trpc` mount. The `/api` OpenAPI middleware and the
> existing custom `/api` routers (backup, sso) are NOT wrapped by it. So the new
> Express routes get NO CSRF protection for free — we must add the
> `x-requested-with: XMLHttpRequest` check ourselves on the state-changing routes.

## API endpoints
- [x] `POST /api/cards/{cardId}/attachments` — multipart single-file streaming upload, returns 201 + `attachmentSchema` (Express; auth + CSRF; board `edit`)
- [x] `GET /api/attachments/{id}/download` — stream object with RFC 5987 `Content-Disposition: attachment` (Express; auth; board `view`)
- [x] `attachments.list` — tRPC GET `/attachments` `?cardId=` list a card's attachments (board `view`)
- [x] `attachments.delete` — tRPC DELETE `/attachments/{id}` delete row + storage object (uploader or board `owner`)

## 0. Object storage client (`features/attachment/attachment.storage.ts`)
- [x] add `minio` (and, for streaming multipart, `busboy` + `@types/busboy`) to
  `packages/backend/package.json` dependencies; `pnpm install`.
- [x] env (`config/env.config.ts`): `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`,
  `MINIO_SECRET_KEY` already exist (reuse). Add `MINIO_PORT`
  (`z.coerce.number().default(9000)`), `MINIO_USE_SSL`
  (`z.enum(["true","false"]).default("false").transform((v) => v === "true")`),
  `MINIO_ATTACHMENTS_BUCKET` (`z.string().default("attachments")`),
  `ATTACHMENT_MAX_BYTES` (`z.coerce.number().default(10485760)` = 10MB).
- [x] define an injectable `Storage` interface:
  `{ putObject(key, stream, size, mime): Promise<void>; getObject(key): Promise<NodeJS.ReadableStream>; statObject(key): Promise<{ size: number }>; removeObject(key): Promise<void>; removePrefix(prefix): Promise<void>; ensureBucket(): Promise<void>; isEnabled(): boolean }`
  backed by a lazily-constructed `Minio.Client` (built from the env above).
  Export a default singleton `storage` AND the interface, so services accept it
  as a parameter and tests inject a fake (no live MinIO). `removePrefix` uses
  `listObjectsV2(bucket, prefix, true)` -> collect keys -> `removeObjects`.
- [x] `isEnabled()` — `env.MINIO_ENDPOINT` non-empty. When disabled, the
  service throws `STORAGE_UNAVAILABLE` (mapped to 503) for upload + download;
  the constructor must be lazy so an empty/invalid endpoint NEVER throws at
  module load (boot must not crash). `ensureBucket()` is a no-op when disabled.
- [x] `ensureBucket()` — idempotent: `bucketExists` then `makeBucket` if absent;
  swallow "already owned/exists" races. Called best-effort on startup (logged,
  never fatal).

## 1. Database (migration + db types)
- [x] `migrations/013.attachment.ts` (next free number is 013; highest existing
  is 012.comment) — mirror `012.comment.ts` style (`sql` import,
  `gen_random_uuid()` default). `attachments` table: `id uuid pk default
  gen_random_uuid()`, `card_id uuid notnull references cards.id on delete
  cascade`, `uploader_id uuid notnull references users.id on delete cascade`,
  `filename text notnull`, `mime_type text notnull`, `size_bytes bigint
  notnull`, `storage_key text notnull unique`, `created_at timestamptz notnull
  default now()`. Add `attachments_card_idx` on `card_id`. `down` drops the
  table `.ifExists()`.
- [x] `db/types.ts` — add `AttachmentsTable`: `id: Generated<string>`,
  `card_id: string`, `uploader_id: string`, `filename: string`,
  `mime_type: string`,
  `size_bytes: ColumnType<string, string | number, string | number>`
  (CORRECTED: node-pg returns `bigint` as a string — mirror
  `BackupRunsTable.size_bytes`, NOT `ColumnType<number, ...>`; parse to Number
  in the repo/service), `storage_key: string`, `created_at: GeneratedTimestamp`.
  Register `attachments: AttachmentsTable` in the `Database` interface.
- [x] migration spec `013.attachment.spec.ts` (mirror `004.board.spec.ts`:
  pg-mem + registered `gen_random_uuid`, run up001/up003/up004/up005/up006 then
  up013 to satisfy the FK chain). Assert: up creates table + index; inserting a
  row works; deleting the parent card cascades its attachment rows; deleting the
  uploader user cascades its rows; `down` drops the table.

## 2. Shared schemas + errors (`packages/shared`)
- [x] `src/attachment.schema.ts` — constants `ATTACHMENT_FILENAME_MAX` (255),
  `ATTACHMENT_MAX_BYTES` (10485760, source of truth shared with frontend),
  `ATTACHMENT_ALLOWED_MIME` allowlist. CORRECTED allowlist policy: include
  `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `application/pdf`,
  `text/plain`, `text/csv`, common office docs
  (`application/msword`,
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
  `application/vnd.ms-excel`,
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`),
  `application/zip`. EXCLUDE `image/svg+xml` (stored XSS: an SVG served from the
  app origin can run script). If SVG is later required, it must only be served
  with `Content-Disposition: attachment` + `Content-Type: application/octet-stream`
  + `X-Content-Type-Options: nosniff`. Inputs `listAttachmentsInput`
  (`{ cardId: z.string() }`), `deleteAttachmentInput` (`{ id: z.string() }`).
  Output `attachmentSchema` (`id, cardId, uploaderId, filename, mimeType,
  sizeBytes: z.number(), createdAt: z.date(), downloadUrl`).
- [x] `src/card.schema.ts` — extend `cardSchema` with
  `attachmentCount: z.number()` (placed alongside `commentCount`; the card
  payload is the only card shape — `boardDataSchema` reuses `cardSchema`).
- [x] `src/errors/attachment.error.ts` — `AttachmentError` const object:
  `FORBIDDEN`, `ATTACHMENT_NOT_FOUND`, `CARD_NOT_FOUND`, `FILE_TOO_LARGE`,
  `UNSUPPORTED_TYPE`, `NO_FILE`, `FILENAME_TOO_LONG`, `STORAGE_UNAVAILABLE`,
  `UNAUTHORIZED` (used by the Express auth middleware).
- [x] `src/index.ts` — add `export * from "./attachment.schema.js";` and
  `export * from "./errors/attachment.error.js";` (the barrel exports each file
  explicitly; it does NOT auto-discover).
- [x] `pnpm --filter shared build` so backend + frontend pick up the new types.

## 3. Attachment feature (`features/attachment`)
- [x] `attachment.repo.ts` — `create(db, row)` (returningAll, parse size to
  Number on the way out or in the service), `findById(db, id)`,
  `listByCard(db, cardId)` (ordered `created_at asc`), `delete(db, id)`,
  `countByCards(db, cardIds[]) -> Map<cardId, number>` (batch group-by, mirror
  `comment.repo.countByCards` exactly: empty-input guard + `countAll<string>()`
  + `Number(r.c)`; no N+1), `listKeysByCard(db, cardId) -> string[]` (storage
  keys, for cascade cleanup if ever needed pre-DB-cascade).
- [x] `attachment.service.ts` (functions take `db` and `storage` as params,
  matching the codebase's `(db, user, ...)` convention; no global singletons in
  the service body):
  - `loadCardBoard(db, user, cardId, min)` — `findCardById` -> if missing throw
    `CARD_NOT_FOUND`; `findColumnById(card.column_id)` -> if missing throw
    `CARD_NOT_FOUND`; `loadBoardFor(db, user, column.board_id, min)` and map any
    NOT_FOUND to `CARD_NOT_FOUND` (no existence leak; mirror
    `card.service.loadCardFor` + `enforceBoard`).
  - `createAttachment(db, storage, user, { cardId, filename, mimeType,
    sizeBytes, stream })` — if `!storage.isEnabled()` throw
    `STORAGE_UNAVAILABLE`; `loadCardBoard(..., "edit")`; validate
    `filename.length <= ATTACHMENT_FILENAME_MAX` (`FILENAME_TOO_LONG`),
    `mimeType` in allowlist (`UNSUPPORTED_TYPE`),
    `sizeBytes <= ATTACHMENT_MAX_BYTES` (`FILE_TOO_LARGE`); generate
    `id = crypto.randomUUID()` and a SANITIZED `storage_key =
    cards/{cardId}/{id}{ext}` where `ext` is derived from `path.extname(filename)`
    lowercased and whitelisted to `[A-Za-z0-9.]` (no raw filename in the key —
    prevents path traversal / `../` / NUL); `storage.putObject(key, stream,
    sizeBytes, mimeType)` THEN insert the row; wrap the insert in try/catch and
    on failure call `storage.removeObject(key)` best-effort (log on miss) to
    avoid orphan objects, then rethrow. Return `attachmentSchema` with
    `downloadUrl = /api/attachments/{id}/download`.
  - `listAttachments(db, user, { cardId })` — `loadCardBoard(..., "view")`;
    return `listByCard` mapped to `attachmentSchema`.
  - `deleteAttachment(db, storage, user, { id })` — `findById` else
    `ATTACHMENT_NOT_FOUND`; `loadCardBoard(db, user, row.card_id, "view")` to get
    the board perm; allow if `row.uploader_id === user.id` OR perm is `owner`,
    else `FORBIDDEN`; `storage.removeObject(row.storage_key)` best-effort (log on
    miss, do NOT fail the delete if the object is already gone) THEN
    `repo.delete`. Return `{ ok: true }`.
- [x] `attachment.http.ts` — Express `Router` (import `appDb`, `env`, `logger`,
  the `storage` singleton, and the service):
  - auth middleware `requireUser(req,res,next)` — CORRECTED: replicate the
    `trpc/trpc.ts` protectedProcedure flow, not backup.http: parse cookies
    (`cookie.parse(req.headers.cookie ?? "")`), read `access_token`; if absent
    -> 401 `UNAUTHORIZED`; `verifyAccessToken` in try/catch -> 401 on throw;
    `findPublicUserById(appDb, sub)` -> 401 if missing; reject if
    `!email_verified` -> 401; `findUserGlobalPerms` for `isSuperuser`; attach
    `req.authUser = { id, isSuperuser }` (the `CtxUser` shape `loadBoardFor`
    expects). (Maintenance-mode gate from protectedProcedure is out of scope for
    file routes; note the deviation.)
  - CSRF middleware on POST/DELETE only — reject unless
    `req.get("x-requested-with") === "XMLHttpRequest"` with 403 (the app-wide
    `csrfGuard` does NOT cover `/api`; we add our own). GET download is exempt
    (so a plain `<a download>` link works without a custom header).
  - `POST /cards/:cardId/attachments` — `requireUser` + CSRF; use `busboy`
    single-file streaming with `limits.fileSize = ATTACHMENT_MAX_BYTES` AND a
    manual running byte counter so we abort mid-stream (do NOT buffer the whole
    file). On busboy `limit`/truncation event: destroy the stream and respond
    413 `FILE_TOO_LARGE` (and best-effort remove any partially-put object). No
    file part -> 400 `NO_FILE`. Pull `filename`, `mimeType` from the part; call
    `createAttachment(appDb, storage, req.authUser, {...})`; respond 201 +
    `attachmentSchema`. (busboy's `fileSize` limit is the hard cap; the
    `sizeBytes` value passed to MinIO must be the actual streamed byte count, not
    a client-claimed length — count bytes as they pass through.)
  - `GET /attachments/:id/download` — `requireUser`; load the row + board `view`
    via the service (reuse the delete-path load, or a `loadForDownload`);
    `statObject` to confirm the object exists (404 if not); set `Content-Type`
    from `mime_type`, `Content-Length` from `size_bytes`,
    `X-Content-Type-Options: nosniff`, and `Content-Disposition: attachment;
    filename="<ascii-fallback>"; filename*=UTF-8''<rfc5987-encoded>` (always
    `attachment`, never `inline`, to neutralize HTML/SVG XSS); pipe
    `storage.getObject` to `res` with stream error handling (on stream error
    after headers sent, destroy the response; log). 404 on missing row/object;
    503 when storage disabled.
  - error mapper — translate thrown `AttachmentError` codes to the JSON error
    body `{ error: <code> }` with status: FORBIDDEN 403, *_NOT_FOUND 404,
    FILE_TOO_LARGE 413, UNSUPPORTED_TYPE 415, NO_FILE/FILENAME_TOO_LONG 400,
    STORAGE_UNAVAILABLE 503, UNAUTHORIZED 401; unknown -> 500. (TRPCError thrown
    by `loadBoardFor` carries a `message` = the error constant and a `code`; map
    both forms.)
- [x] `index.ts` — `import { attachmentHttpRouter }` and
  `app.use("/api", attachmentHttpRouter)` placed BEFORE the `/trpc` and the
  `/api` OpenAPI `express.json()` middleware (so the multipart routes own these
  paths and never hit the JSON body parser), alongside the existing
  `backupHttpRouter`/`ssoHttpRouter` mounts. In the `app.listen` callback call
  `storage.ensureBucket().catch((err) => logger.error({ err }, "ensure
  attachments bucket failed"))` — best-effort, non-fatal (mirror the other
  startup `.catch` calls).
- [x] `attachment.router.ts` — tRPC `attachmentsRouter`: `list`
  (`protectedProcedure`, `.meta` openapi GET `/attachments`, input
  `listAttachmentsInput`, output `z.array(attachmentSchema)`, calls
  `listAttachments(ctx.db, user(ctx), input)`) and `delete`
  (`protectedProcedure`, `.meta` openapi DELETE `/attachments/{id}`, input
  `deleteAttachmentInput`, output `okSchema`, calls
  `deleteAttachment(ctx.db, storage, user(ctx), input)`). Mirror
  `card.router.ts`'s `user(ctx)` helper. Register as `attachments:
  attachmentsRouter` in `trpc/router.ts`.
- [x] `features/card/card.enrich.ts` — add
  `const attCounts = await attachmentRepo.countByCards(db, ids)` next to the
  existing comment count call, and include
  `attachmentCount: attCounts.get(r.id) ?? 0` in the mapped `Card`. Used
  automatically by `boards.getData` (which calls `enrichCards`).
- [x] `features/card/card.service.ts` `deleteCard` — CORRECTED scope note: the
  DB cascade (`attachments.card_id ... on delete cascade`) already removes the
  rows when `repo.deleteCard` runs, but the MinIO OBJECTS are not cascaded.
  Thread `storage` into `deleteCard` (change signature to
  `deleteCard(db, storage, user, id)` and update `card.router.ts` + its callers)
  and after `repo.deleteCard` call
  `storage.removePrefix("cards/" + id + "/").catch((err) => logger.error(...))`
  — best-effort, wrapped, never fatal. (Alternative if signature churn is
  undesirable: collect `listKeysByCard` before delete and remove them; but
  prefix-delete is simpler and matches the storage_key layout.)

## 4. Tests
Backend specs use pg-mem + a FAKE injected `Storage` (record calls; no live
MinIO). Mirror `features/card/test` (tRPC caller helpers re-exported from
`board/test`). NOTE (corrected): there is NO `supertest` in the repo and the
backup HTTP routes are tested by calling the service directly, NOT over HTTP. Two
options for the Express upload/download routes — pick one and state it:
(a) add `supertest` + `@types/supertest` as devDeps and drive a real
`express()` app with the router mounted; or (b) export the route handlers and
call them with mock `req`/`res` (busboy can be fed a real multipart `Readable`).
Plan assumes (a) is added.

- [x] service `createAttachment`: editor uploads -> row inserted + fake
  `putObject` called with the generated `cards/{cardId}/{id}{ext}` key;
  view-only member -> FORBIDDEN; storage_key never contains the raw filename
  (path-traversal filename like `../../etc/passwd` is sanitized).
- [x] service: `sizeBytes` over cap -> FILE_TOO_LARGE (no put, no row); mime not
  in allowlist (incl. `image/svg+xml`) -> UNSUPPORTED_TYPE; filename over 255 ->
  FILENAME_TOO_LONG.
- [x] service: storage disabled (`isEnabled()` false) -> STORAGE_UNAVAILABLE on
  upload AND download; no row written; no put called.
- [x] service: DB insert throws after put -> `removeObject(key)` called (no
  orphan) and the error propagates.
- [x] service `listAttachments`: returns a card's attachments ordered
  `created_at asc`; card on an inaccessible board -> CARD_NOT_FOUND (no leak).
- [x] service `deleteAttachment`: uploader (non-owner) ok; board owner (non-
  uploader) ok; other editor who is neither -> FORBIDDEN; on success
  `removeObject` called then row gone; already-missing object -> still deletes
  the row (no throw); unknown id -> ATTACHMENT_NOT_FOUND.
- [x] enrich/getData: card payload carries correct `attachmentCount`; assert a
  single batched count query (no N+1) — e.g. seed N cards, spy the repo.
- [x] card `deleteCard`: removes attachment rows (DB cascade) AND calls
  `storage.removePrefix("cards/{id}/")`.
- [x] http upload (option a, supertest): happy path 201 + `attachmentSchema`;
  streamed body OVER cap aborts mid-stream -> 413 (assert the whole file was not
  buffered, e.g. via a large stream); bad mime -> 415; missing file part -> 400;
  unauthenticated (no cookie / bad token / unverified user) -> 401; missing
  `x-requested-with` -> 403.
- [x] http download: streams bytes with correct `Content-Type`,
  `Content-Length`, `X-Content-Type-Options: nosniff`, and RFC 5987
  `Content-Disposition: attachment; filename*=UTF-8''...`; no board access -> 404;
  unknown id -> 404; storage disabled -> 503; unauthenticated -> 401.
- [x] migration `013.attachment.spec.ts`: up/down + card-cascade + user-cascade.

## 5. Verify
- [x] `pnpm --filter shared build`
- [x] `pnpm --filter backend test` green (storage faked)
- [x] `pnpm --filter backend migrate` auto-discovers `013.attachment`
  (verified via the pg-mem migration spec; live Postgres not run locally).
- [x] Swagger shows the `attachments.list` / `attachments.delete` tRPC routes
  (the Express upload/download routes are documented here, not in OpenAPI — same
  as `backup.http`/`sso.http`).
- [x] Boot with `MINIO_ENDPOINT` empty does NOT crash; upload/download return
  503.
