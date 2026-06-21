# Backup — Backend Plan (Google Drive OAuth, full lifecycle)

## Decisions (locked)

- Destination: Google Drive via OAuth 2.0; refresh token in DB.
- Scope: full lifecycle (OAuth, schedule, retention, history, restore, alerts).
- Contents: Postgres (`pg_dump`) + MinIO objects (`mc mirror`). No config files.
- Restore: triggered from UI, gated by maintenance mode + confirm modal.
- Stack: Node/TS, Express + tRPC (`trpc-to-openapi`), Kysely, pg, MinIO.

## Architecture

- New feature folder `src/features/backup/` (matches `.claude/rules/backend.md`).
- New migration `007.backup.ts` (next after `006.card.ts`).
- New permissions `admin:backup:read`, `admin:backup:manage` in `shared/rbac.schema.ts`.
- Authz via existing `globalProcedure(Permission.AdminBackup*)`; superuser bypasses.
- In-process scheduler using `croner` (tiny, TS-native, tz-aware). Reads settings from DB on boot + on settings change; timezone `Asia/Ho_Chi_Minh`.
- Google Drive via official `googleapis` (OAuth + resumable upload/download/delete). No rclone needed.
- OAuth callback is a plain Express route (Google redirect), not tRPC.
- Maintenance mode: flag in `backup_settings`; tRPC middleware returns 503 for non-superuser during maintenance.
- Container tools: add `postgresql-client` (pg_dump/psql) + MinIO `mc` + `tar`/`gzip` to `backend.Dockerfile`. Bind a writable tmp/work dir.

## Files to add / change

- [x] `packages/shared/src/rbac.schema.ts` — add `AdminBackupRead`, `AdminBackupManage` to `Permission` + `PERMISSION_CATALOG`.
- [x] `packages/shared/src/backup.schema.ts` — zod schemas/types (settings, run, inputs); re-export from `shared` index.
- [x] `packages/backend/src/migrations/007.backup.ts` — tables `backup_settings`, `backup_runs`.
- [x] `packages/backend/src/features/backup/backup.repo.ts` — Kysely queries.
- [x] `packages/backend/src/features/backup/backup.service.ts` — orchestration (run, retention, restore, maintenance).
- [x] `packages/backend/src/features/backup/backup.gdrive.ts` — OAuth + Drive upload/download/delete/revoke.
- [x] `packages/backend/src/features/backup/backup.job.ts` — dump/mirror/tar/upload pipeline (child_process).
- [x] `packages/backend/src/features/backup/backup.scheduler.ts` — croner registration + reschedule.
- [x] `packages/backend/src/features/backup/backup.router.ts` — tRPC router (endpoints below).
- [x] `packages/backend/src/features/backup/backup.http.ts` — Express OAuth callback route.
- [x] `packages/backend/src/trpc/router.ts` — mount `backupRouter`.
- [x] `packages/backend/src/trpc/trpc.ts` — add `maintenanceGuard` middleware; apply to non-admin procedures.
- [x] `packages/backend/src/index.ts` — start scheduler after DB ready; mount callback route.
- [x] `packages/backend/src/config/env.config.ts` — `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`, `GDRIVE_REDIRECT_URI`, `GDRIVE_FOLDER_ID?`, `BACKUP_WORK_DIR`, `BACKUP_ENCRYPTION_PASSPHRASE?`.
- [x] `packages/backend/src/config/const.config.ts` — backup log-event constants (no string literals in logs).
- [x] `packages/infra/backend.Dockerfile` — install `postgresql-client`, `mc`, `tar`, `gzip`.
- [x] `packages/infra/docker-compose.yml` — bind mount work dir; pass GDRIVE env via `.env.prod`.
- [x] `packages/backend/package.json` — add `croner`, `googleapis`.

## DB schema

`backup_settings` (singleton, id=1):
- [x] `id` int PK (always 1), `enabled` bool, `schedule_kind` enum(`daily|weekly|monthly|cron`), `cron_expr` text null, `retention_mode` enum(`simple|gfs`), `retention_days` int null, `gfs_daily/gfs_weekly/gfs_monthly` int null, `include_minio` bool, `encryption_enabled` bool, `gdrive_email` text null, `gdrive_refresh_token` text null (encrypted at rest), `gdrive_folder_id` text null, `maintenance` bool default false, `updated_at` timestamptz.

`backup_runs`:
- [x] `id` uuid PK, `started_at`, `finished_at` null, `status` enum(`running|success|failed`), `trigger` enum(`scheduled|manual`), `size_bytes` bigint null, `drive_file_id` text null, `file_name` text, `checksum` text null, `error` text null, `expires_at` timestamptz null (retention), `created_at`. Index on `started_at desc`, `status`.

## Backup job pipeline (`backup.job.ts`)

- [x] Create unique work dir under `BACKUP_WORK_DIR`.
- [x] `pg_dump` (custom format) of the app DB using connection from env → `db.dump`.
- [x] If `include_minio`: `mc mirror` configured bucket(s) → `minio/`.
- [x] `tar czf backup-<ts>.tar.gz` over the work dir; compute sha256 checksum.
- [x] Optional GPG/age symmetric encryption with `BACKUP_ENCRYPTION_PASSPHRASE` when `encryption_enabled`.
- [x] Resumable upload stream to Drive folder via `googleapis`; capture `drive_file_id` + size.
- [x] Insert/Update `backup_runs` row; set `expires_at` from retention policy.
- [x] Always clean the work dir (finally).
- [x] On failure: mark run `failed` + error; emit alert (Telegram via existing Grafana/Loki path, or log event picked up by alerting).

## Retention (`backup.service.ts`)

- [x] After each successful run, compute deletions: `simple` = older than N days; `gfs` = keep N daily/weekly/monthly newest.
- [x] Delete Drive file (`files.delete`) + mark/delete DB row. Never delete a `running` row.

## Restore flow

- [x] Require maintenance mode ON before restore (enforced server-side).
- [x] Download tar.gz from Drive → work dir; verify checksum; decrypt if needed.
- [x] `pg_restore --clean --if-exists` into DB; `mc mirror` back to MinIO bucket(s).
- [x] Record outcome; auto-leave maintenance only on explicit admin action (not automatic).

## Maintenance mode

- [x] `maintenanceGuard` middleware in `trpc.ts`: if `backup_settings.maintenance` true and user not superuser → `TRPCError SERVICE_UNAVAILABLE`.
- [x] Cache flag in memory, refresh on toggle; avoids per-request DB hit.

## Scheduler

- [x] On boot: if `enabled`, register croner job from `schedule_kind`/`cron_expr`, tz `Asia/Ho_Chi_Minh`.
- [x] On settings update: stop existing job, re-register.
- [x] Single-flight guard: skip new run if one is `running`.

## Google Drive OAuth

- [x] `auth-url`: build consent URL (`access_type=offline`, `prompt=consent`, scope `drive.file`).
- [x] Callback (Express): exchange code → tokens; fetch email; store refresh token (encrypted) + email + folder.
- [x] `disconnect`: revoke token at Google; null out token/email in DB.
- [x] Refresh access token on demand from stored refresh token.

## API endpoints (method, path — description)

- [x] GET    /admin/backup/settings — get settings + Drive connection status
- [x] PUT    /admin/backup/settings — update schedule/retention/toggles
- [x] GET    /admin/backup/gdrive/auth-url — return Google OAuth consent URL
- [x] GET    /admin/backup/gdrive/callback — OAuth redirect; exchange code, store refresh token (Express route)
- [x] POST   /admin/backup/gdrive/disconnect — revoke + clear stored Drive token
- [x] GET    /admin/backup/status — current job + maintenance state
- [x] POST   /admin/backup/run — trigger a manual backup now
- [x] GET    /admin/backup/runs — list backup history (paginated, filter by date/status)
- [x] GET    /admin/backup/runs/{runId} — get one run detail
- [x] DELETE /admin/backup/runs/{runId} — delete backup (Drive file + DB row)
- [x] POST   /admin/backup/runs/{runId}/restore — restore from a backup (requires maintenance ON)
- [x] POST   /admin/backup/maintenance — toggle maintenance mode on/off

## Phases

- [x] Phase 1 — Foundation: migration `007`, permissions, schemas, repo, settings get/update, Drive OAuth (auth-url/callback/disconnect), manual run + job pipeline (pg_dump + tar + upload), runs list/get.
- [x] Phase 2 — Scheduler & retention: croner integration, scheduled runs, retention cleanup, delete endpoint, MinIO mirror in job.
- [x] Phase 3 — Restore & maintenance: maintenance toggle + guard, restore endpoint + flow, status endpoint.
- [x] Phase 4 — Hardening: encryption, checksum integrity check, failure alerts (Telegram/Loki), GFS retention, periodic restore test doc.

## Testing cases (vitest, in-memory pg per `.claude/rules/backend.md`)

Auth / RBAC
- [x] Non-admin user → all `/admin/backup/*` return FORBIDDEN.
- [x] Superuser bypasses permission check.
- [x] `admin:backup:read` can GET settings/runs but PUT/run/delete/restore → FORBIDDEN.
- [x] `admin:backup:manage` can mutate.

Settings
- [x] PUT validates cron expr (reject invalid) and retention values (positive ints).
- [x] Updating schedule re-registers scheduler (spy on scheduler.reschedule).
- [x] GET returns connection status `disconnected` when no refresh token.

OAuth (Drive client mocked)
- [x] auth-url contains offline access + `drive.file` scope.
- [x] callback stores refresh token + email; disconnect clears them and revokes.

Backup job (child_process + Drive mocked)
- [x] Successful run inserts `success` row with size, drive_file_id, checksum, expires_at.
- [x] pg_dump non-zero exit → run marked `failed` with error; work dir cleaned.
- [x] Single-flight: second run while one `running` is rejected/skipped.
- [x] `include_minio=false` skips `mc mirror`.

Retention
- [x] simple mode deletes runs older than N days (Drive delete called, row removed).
- [x] gfs keeps correct counts of daily/weekly/monthly.
- [x] `running` rows never deleted.

Restore
- [x] Restore rejected when maintenance OFF.
- [x] With maintenance ON: download + pg_restore + mirror invoked in order; checksum mismatch aborts.

Maintenance guard
- [x] maintenance ON → normal user request returns SERVICE_UNAVAILABLE; superuser/admin still works.
- [x] Toggling off restores normal access.

OpenAPI
- [x] All endpoints appear in generated OpenAPI with `protect: true` (extend existing openapi spec test).

## Technical notes

- Secrets (`GDRIVE_CLIENT_SECRET`, encryption passphrase) come from env, not DB; only the refresh token persists in DB (encrypt at rest).
- Drive Testing-mode refresh tokens expire in 7 days; publish the OAuth app to Production for permanent tokens.
- Google Drive free tier = 15GB; surface used/quota in status; alert when near full (Phase 4).
- Scheduler runs only where the backend process runs (dev + prod VPS); local dev can trigger manual run but Drive/mc may be absent — guard with clear errors.
- Use log-event constants in `const.config.ts`; integrate run outcomes with Loki/Grafana for alerting.

## Added during implementation (not in original plan)

- [x] `GET /admin/backup/upcoming` — next scheduled run times within 7 days (croner `nextRuns`, tz `Asia/Ho_Chi_Minh`). Powers the UI "Upcoming" list.
- [x] Migration `008.backup-folder.ts` — `gdrive_folder_name` column. Admin-managed folder name with a per-env default (`Trello Clone Backups (local|dev|prod)`) so each env backs up to its own folder. `gdrive_folder_id` is now a resolved cache (invalidated when the name changes).
- [x] `ensureBackupFolder(name)` — find-or-create the named Drive folder (scope `drive.file` only sees app-created folders); resolved on connect + before each run; id exposed read-only in settings for the UI "Open Drive folder" link.
- [x] OAuth hardening: identity carried via an HMAC-signed `state` param (`createOAuthState`/`verifyOAuthState`), not the session cookie — the callback is a cross-site redirect and `SameSite=strict` cookies aren't sent. Added `openid`+`userinfo.email` scopes to read the connected account email.
- [x] `tar --force-local` so Windows `C:\...` archive paths aren't read as a remote host (no-op on Linux).
- [x] Extra env: `APP_BASE_URL` (callback redirect target), `BACKUP_TOKEN_SECRET` (refresh-token + state signing key; falls back to `JWT_REFRESH_SECRET`), `MINIO_BACKUP_BUCKETS`, `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` (for `mc`).
- [x] `backupSettingsSchema` now returns `gdriveFolderName` + `gdriveFolderId` (read-only).

### Still pending

- [ ] Drive used/quota in status + near-full alert (Phase 4 technical note).
- [ ] Periodic restore-test doc (Phase 4).
- [ ] Dedicated Telegram alert wiring (failures currently emit `LogEvent.BackupFailed`; relies on Loki/Grafana alerting).
