# Attachments — Plan Audit

Production-readiness audit of `attachments.backend.md` + `attachments.frontend.md`
against the real codebase. Verified every cited file/function. Both plans were
rewritten in place; this file records what was wrong and what changed.

## Severity legend
- BLOCKER: would ship a security hole or a non-working/crashing feature.
- HIGH: correctness or production-readiness gap that needs fixing before build.
- MED: misleading/wrong reference that would derail the implementer.
- LOW: clarity / minor.

## Issues found

### BLOCKER — Express cookie auth was under-specified and wrong-modeled
The plan said "reuse the same helper the tRPC context uses; mirror how
backup/sso http authenticate". Verified: `trpc/context.ts` only does
`verifyAccessToken(access).sub` to set `userId`; the REAL authz
(`findPublicUserById`, reject `!email_verified`, resolve `isSuperuser` via
`findUserGlobalPerms`) lives in `trpc/trpc.ts` `protectedProcedure`. There is no
single shared helper. `backup.http.ts` does NOT use the cookie at all (signed
`state` param). Mirroring backup would accept tokens for deleted/unverified users
and would never set `isSuperuser`, which `loadBoardFor` needs. Changed the plan
to replicate the full trpc.ts flow in a `requireUser` middleware that yields a
`CtxUser` (`{ id, isSuperuser }`).

### BLOCKER — CSRF claim about `csrfGuard` being app-wide is false
The plan claimed the app-wide `csrfGuard` guards the OpenAPI/tRPC layer and the
custom routes sit before it. Verified in `index.ts`: `csrfGuard` is applied ONLY
to the `/trpc` mount. The `/api` OpenAPI middleware and the existing custom
`/api` routers (backup, sso) are NOT wrapped. So the new routes get zero CSRF
for free. Corrected: the new router MUST add its own
`x-requested-with: XMLHttpRequest` check on POST/DELETE (GET download exempt).

### BLOCKER — SVG in the MIME allowlist (stored XSS)
Plan included `image/svg+xml`. Served from the app origin an SVG can execute
script. Removed SVG from the allowlist; added a hard rule that downloads are
always served with `Content-Disposition: attachment` + `X-Content-Type-Options:
nosniff` (never `inline`) so any HTML-ish content cannot run in the app origin.

### HIGH — bigint column typed wrong in db/types.ts
Plan suggested `size_bytes: ColumnType<number, number, never>`. Verified the
codebase convention (`BackupRunsTable.size_bytes`): node-pg returns `bigint` as a
STRING, typed `ColumnType<string, string | number, ...>` and parsed with
`Number()` in the service. Corrected the type and added "parse to Number" in the
repo/service + the `attachmentSchema` `sizeBytes: z.number()`.

### HIGH — streaming byte cap detail
Plan said "enforce during streaming, abort, do not buffer" but left it abstract
and floated `multer memory` as an option (memory = buffering = defeats the cap).
Pinned it to `busboy` with `limits.fileSize` + a running byte counter, abort +
413 on the limit event, and the MinIO `size` argument must be the ACTUAL streamed
count, not a client-claimed length.

### HIGH — filename / path-traversal in storage_key
Plan said "ext derived safely... sanitized" but vaguely. Made it explicit:
`storage_key = cards/{cardId}/{uuid}{ext}`, ext from `path.extname` lowercased and
whitelisted to `[A-Za-z0-9.]`; the raw filename never enters the key (prevents
`../`, NUL, traversal). Filename is stored only as a metadata column and emitted
RFC 5987-encoded in `Content-Disposition`.

### HIGH — tests assume `supertest`, which is not in the repo
Verified: no `supertest` dependency; backup "http" specs actually call the
service directly (`oauth.spec.ts`), not over HTTP. Plan's "http via supertest"
was unsupported. Corrected to: either add `supertest` + `@types/supertest`
(option a, now the assumed path) or export handlers and drive them with mock
req/res (option b). Stated explicitly.

### MED — `loadBoardFor` signature cited wrong
Plan wrote `loadBoardFor(db, user, boardId, min)`. Real signature is
`loadBoardFor(db, user, id, min)` and it throws TRPCError NOT_FOUND/FORBIDDEN
(must be caught and remapped to `CARD_NOT_FOUND`, exactly like
`card.service.enforceBoard`). Corrected and referenced the real pattern.

### MED — migration number / spec references
Confirmed next free migration is `013` (highest existing `012.comment`). Confirmed
`004.board.spec.ts` pg-mem setup (registers `gen_random_uuid`, runs prior `up`s to
satisfy FKs). Made the spec task list the exact prerequisite migrations to run and
the cascade assertions (card-cascade AND user-cascade).

### MED — `removePrefix` on card delete needs a signature change
Plan put `storage.removePrefix` inside `deleteCard` but `deleteCard(db, user, id)`
has no storage param today. Called this out: thread `storage` through
`deleteCard` (and update `card.router.ts` + callers), or pre-collect keys. Also
clarified DB cascade removes ROWS but not MinIO OBJECTS.

### MED — orphan-object handling made concrete
Kept the put-then-insert + best-effort `removeObject` on insert failure, but
specified try/catch + rethrow so the orphan cleanup is actually wired and tested.

### MED — storage-disabled boot safety
Made the MinIO client lazily constructed and `isEnabled()` gate explicit so an
empty/invalid `MINIO_ENDPOINT` cannot throw at module load (boot must not crash);
`ensureBucket` best-effort in `app.listen` with `.catch`, mirroring existing
startup calls.

### MED (frontend) — delete gating was wrong
Plan gated delete behind `canEdit`. Server enforces uploader-OR-owner. A plain
editor cannot delete others' attachments. Corrected the UI to gate delete by
`currentUserId === uploaderId || isOwner` (mirroring CommentList/CommentItem),
upload by `canEdit`, and to always handle a server FORBIDDEN.

### LOW (frontend) — date deserialization mismatch
tRPC `list` uses superjson (`createdAt` is a `Date`); the multipart upload
response is plain JSON (`createdAt` is an ISO string). Flagged: convert on merge
or rely on list invalidation. Also pinned `withCredentials` + the
`x-requested-with` header on the XHR, and that `attachmentErrorMessage` must
accept both a raw `code` (XHR body) and a tRPC error object.

### LOW — shared barrel export
Confirmed `shared/src/index.ts` exports each file explicitly (no auto-discovery);
added the two explicit `export *` lines as tasks. Confirmed `cardSchema` is the
single card shape reused by board data (so `attachmentCount` is added once).

## What changed in the plan files
- backend: rewrote auth + CSRF sections to match `trpc.ts`/`index.ts` reality;
  removed SVG; fixed bigint type; pinned busboy streaming cap + storage_key
  sanitization + RFC 5987 + nosniff + always-attachment; corrected `loadBoardFor`
  signature; made orphan cleanup, storage-disabled boot, and card-delete object
  cleanup concrete; replaced supertest assumption with two stated options; fixed
  migration number and cascade spec.
- frontend: corrected delete gating to uploader/owner; pinned XHR credentials +
  CSRF header + error-code mapping; noted JSON-vs-superjson date handling;
  aligned optimistic count + rollback with `CommentList`.
- Both kept the `.claude/rules/plans.md` format (`- [ ]` tasks, single-line
  endpoints, dedicated test-cases section).

## Residual risks / decisions for the implementer
- Maintenance-mode gate (in `protectedProcedure`) is intentionally NOT applied to
  the Express file routes; confirm that is acceptable.
- Choose supertest (option a) vs mock-req/res (option b) for HTTP route tests.
- Decide whether to thread `storage` through `deleteCard` or pre-collect keys.
