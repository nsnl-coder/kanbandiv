# Backup — Frontend Plan (Admin UI)

Pairs with [backup.backend.md](./backup.backend.md). Page lives under the admin area, guarded by `admin:backup:read` (view) / `admin:backup:manage` (mutate). Uses existing tRPC client.

## Route / page

- [x] `/admin/backup` page, linked from admin nav (visible only with `admin:backup:read` or superuser).
- [x] Tabs/sections: Connection, Schedule, History, Restore.

## Sections

Connection (Google Drive)
- [x] Show status: connected email + token validity, or "Not connected".
- [x] "Connect Google Drive" → open consent URL from `gdrive/auth-url`; handle redirect return, refetch settings.
- [x] "Disconnect" with confirm.

Schedule & retention
- [x] Toggle: enable/disable automatic backup.
- [x] Frequency: Daily / Weekly / Monthly quick picks + Advanced cron input (validated).
- [x] Retention: simple (N days) or GFS (daily/weekly/monthly counts).
- [x] Toggles: include MinIO, encryption.
- [x] Save → `PUT /admin/backup/settings`; "Backup now" → `POST /admin/backup/run` with progress/status polling via `GET /admin/backup/status`.

History
- [x] Paginated table: started_at, status badge (success/failed/running), size, file name, expires_at. (Shows latest 50; reorganized into the "Transactions" tab - see additions.)
- [ ] Filter by date/status. (Backend input supports it; no UI filter yet.)
- [x] Row actions: delete (confirm) → `DELETE /admin/backup/runs/{id}`; restore → opens Restore flow. (Actions live in the "All backups" tab.)

Restore (maintenance-gated)
- [x] Step 1: confirm modal "Restore overwrites current data".
- [x] Step 2: enforce maintenance mode — call `POST /admin/backup/maintenance {on:true}`, show banner "App in maintenance".
- [x] Step 3: `POST /admin/backup/runs/{id}/restore`; show progress.
- [x] Step 4: on success, prompt to leave maintenance (`maintenance {on:false}`).
- [x] Global maintenance banner shown app-wide when active.

## State / data

- [x] tRPC queries: settings, status, runs (paginated). Invalidate on mutations.
- [x] Disable mutate controls when user lacks `admin:backup:manage`.
- [x] Status polling only while a run/restore is in progress.

## Testing cases (e2e in `e2e/frontend`, component tests as used)

- [x] Non-admin: `/admin/backup` not in nav and route blocked.
- [x] read-only admin: sees data, mutate controls disabled.
- [x] Connect flow: clicking connect opens consent URL; after callback, status shows email.
- [x] Save settings: invalid cron shows validation error; valid persists and reflects on reload.
- [x] Backup now: status transitions running → success; new row appears in history.
- [x] Delete backup: confirm required; row removed.
- [x] Restore: blocked until maintenance ON; confirm modal required; maintenance banner appears; leaving maintenance restores normal UI.
- [x] Maintenance ON: normal user session sees maintenance screen (503 handling).

## Added during implementation (not in original plan)

- [x] Page reorganized: Connection + Schedule & retention always visible; the bottom card has two tabs — **All backups** (Upcoming next-7-days + successful backups, with Restore/Delete) and **Transactions** (read-only log of every run). Replaced the original Connection/Schedule/History/Restore section split.
- [x] Status/type labels on every run: `success`/`failed`/`running`, `manual backup`/`auto backup`, `auto-delete` (when it has an expiry, tooltip shows the date), and `upcoming` for scheduled items.
- [x] Backup date shown under the file name.
- [x] "Open Drive folder" link (opens `drive.google.com/drive/folders/<id>` in a new tab) using `gdriveFolderId` from settings.
- [x] Google Drive folder name field rendered but **disabled** for now (per request).
- [x] `useMaintenanceStore` + a tRPC link that flips the app-wide maintenance screen on a `SERVICE_UNAVAILABLE/MAINTENANCE` response and clears it on the next success.
- [x] `backup.upcoming` query for the Upcoming list.
- [x] Dev-only: `/api` vite proxy so the OAuth callback (and `/api/client-log`) reach the backend; local `VITE_OTEL_ENDPOINT` emptied to avoid the OTLP 404.
