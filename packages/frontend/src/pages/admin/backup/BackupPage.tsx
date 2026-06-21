import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BackupRun,
  type BackupSettings,
  Permission,
  type ScheduleKind,
  type RetentionMode,
  type UpdateBackupSettingsInput,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import { useCan } from "../../../features/rbac/hooks/useCan";
import { backupErrorMessage } from "../../../features/backup/errors";
import { useToastStore } from "../../../hooks/useToastStore";

function formatBytes(n: number | null): string {
  if (n == null) return "-";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

const STATUS_STYLES: Record<BackupRun["status"], string> = {
  success: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  running: "bg-amber-100 text-amber-700",
};

function Badge({
  color,
  title,
  children,
}: {
  color: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {children}
    </span>
  );
}

// Status + trigger + retention labels for a backup row.
function RunBadges({ run }: { run: BackupRun }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge color={STATUS_STYLES[run.status]}>{run.status}</Badge>
      <Badge
        color={
          run.trigger === "manual"
            ? "bg-slate-100 text-slate-600"
            : "bg-indigo-100 text-indigo-700"
        }
      >
        {run.trigger === "manual" ? "manual backup" : "auto backup"}
      </Badge>
      {run.expiresAt ? (
        <Badge
          color="bg-gray-100 text-gray-500"
          title={`Auto-deletes ${new Date(run.expiresAt).toLocaleDateString()}`}
        >
          auto-delete
        </Badge>
      ) : null}
    </span>
  );
}

// Local form mirror of settings (kept as strings for number inputs).
interface FormState {
  enabled: boolean;
  scheduleKind: ScheduleKind;
  cronExpr: string;
  retentionMode: RetentionMode;
  retentionDays: string;
  gfsDaily: string;
  gfsWeekly: string;
  gfsMonthly: string;
  includeMinio: boolean;
  encryptionEnabled: boolean;
  gdriveFolderName: string;
}

function toForm(s: BackupSettings): FormState {
  return {
    enabled: s.enabled,
    scheduleKind: s.scheduleKind,
    cronExpr: s.cronExpr ?? "",
    retentionMode: s.retentionMode,
    retentionDays: s.retentionDays?.toString() ?? "14",
    gfsDaily: s.gfsDaily?.toString() ?? "7",
    gfsWeekly: s.gfsWeekly?.toString() ?? "4",
    gfsMonthly: s.gfsMonthly?.toString() ?? "6",
    includeMinio: s.includeMinio,
    encryptionEnabled: s.encryptionEnabled,
    gdriveFolderName: s.gdriveFolderName ?? "",
  };
}

function toInput(f: FormState): UpdateBackupSettingsInput {
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  return {
    enabled: f.enabled,
    scheduleKind: f.scheduleKind,
    cronExpr: f.scheduleKind === "cron" ? f.cronExpr.trim() || undefined : undefined,
    retentionMode: f.retentionMode,
    retentionDays: f.retentionMode === "simple" ? num(f.retentionDays) : undefined,
    gfsDaily: f.retentionMode === "gfs" ? num(f.gfsDaily) : undefined,
    gfsWeekly: f.retentionMode === "gfs" ? num(f.gfsWeekly) : undefined,
    gfsMonthly: f.retentionMode === "gfs" ? num(f.gfsMonthly) : undefined,
    includeMinio: f.includeMinio,
    encryptionEnabled: f.encryptionEnabled,
    gdriveFolderName: f.gdriveFolderName.trim() || undefined,
  };
}

const card = "rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70";
const label = "block text-sm font-medium text-slate-700";
const input =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-100";
const primaryBtn =
  "rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50";

export function BackupPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const canManage = useCan(Permission.AdminBackupManage);
  const toast = useToastStore((s) => s.add);

  const settingsQuery = useQuery(trpc.backup.getSettings.queryOptions({}));
  const statusQuery = useQuery({
    ...trpc.backup.status.queryOptions({}),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const runsQuery = useQuery(trpc.backup.runsList.queryOptions({ limit: 50, offset: 0 }));
  const upcomingQuery = useQuery(trpc.backup.upcoming.queryOptions({}));

  const [tab, setTab] = useState<"all" | "transactions">("all");
  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => {
    if (settingsQuery.data && !form) setForm(toForm(settingsQuery.data));
  }, [settingsQuery.data, form]);

  // Surface the OAuth callback result (?connected=1 / ?error=...).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("connected")) {
      toast("Google Drive connected.", "success");
      window.history.replaceState({}, "", "/admin/backup");
    } else if (p.get("error")) {
      toast("Google Drive connection failed.", "error");
      window.history.replaceState({}, "", "/admin/backup");
    }
  }, [toast]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: trpc.backup.getSettings.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.backup.status.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.backup.runsList.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.backup.upcoming.queryKey() });
  };

  const update = (patch: Partial<FormState>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  const saveMutation = useMutation(
    trpc.backup.updateSettings.mutationOptions({
      onSuccess: () => {
        toast("Settings saved.", "success");
        invalidate();
      },
      onError: (e) => toast(backupErrorMessage(e), "error"),
    }),
  );

  const runMutation = useMutation(
    trpc.backup.run.mutationOptions({
      onSuccess: () => {
        toast("Backup completed.", "success");
        invalidate();
      },
      onError: (e) => toast(backupErrorMessage(e), "error"),
    }),
  );

  const disconnectMutation = useMutation(
    trpc.backup.disconnect.mutationOptions({
      onSuccess: () => {
        toast("Google Drive disconnected.", "success");
        invalidate();
      },
      onError: (e) => toast(backupErrorMessage(e), "error"),
    }),
  );

  const maintenanceMutation = useMutation(
    trpc.backup.maintenance.mutationOptions({
      onSuccess: () => invalidate(),
      onError: (e) => toast(backupErrorMessage(e), "error"),
    }),
  );

  const deleteMutation = useMutation(
    trpc.backup.runsDelete.mutationOptions({
      onSuccess: () => {
        toast("Backup deleted.", "success");
        invalidate();
      },
      onError: (e) => toast(backupErrorMessage(e), "error"),
    }),
  );

  const [pendingDelete, setPendingDelete] = useState<BackupRun | null>(null);
  const [restoreFor, setRestoreFor] = useState<BackupRun | null>(null);

  async function connectDrive() {
    try {
      const { url } = await qc.fetchQuery(trpc.backup.authUrl.queryOptions({}));
      window.location.href = url;
    } catch (e) {
      toast(backupErrorMessage(e), "error");
    }
  }

  const settings = settingsQuery.data;
  const status = statusQuery.data;

  if (settingsQuery.isLoading || !form || !settings) {
    return <p className="text-sm text-slate-500">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Backup
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Schedule snapshots, manage retention, and restore data.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            disabled={runMutation.isPending || !settings.drive.connected}
            onClick={() => runMutation.mutate({})}
            className={primaryBtn}
          >
            {runMutation.isPending ? "Backing up..." : "Backup now"}
          </button>
        ) : null}
      </div>

      {settings.maintenance ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Maintenance mode is <strong>on</strong>. Non-admin users cannot use the
          app.
          {canManage ? (
            <button
              type="button"
              onClick={() => maintenanceMutation.mutate({ on: false })}
              className="ml-2 font-semibold underline"
            >
              Turn off
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Connection */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-slate-800">Google Drive</h2>
        {settings.drive.connected ? (
          <div className="mt-2 flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Connected as <strong>{settings.drive.email}</strong>
            </p>
            <div className="flex items-center gap-4">
              {settings.gdriveFolderId ? (
                <a
                  href={`https://drive.google.com/drive/folders/${settings.gdriveFolderId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                >
                  Open Drive folder
                </a>
              ) : null}
              {canManage ? (
                <button
                  type="button"
                  disabled={disconnectMutation.isPending}
                  onClick={() => disconnectMutation.mutate({})}
                  className="text-sm font-medium text-red-600 hover:text-red-700"
                >
                  Disconnect
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between">
            <p className="text-sm text-slate-600">Not connected.</p>
            {canManage ? (
              <button type="button" onClick={connectDrive} className={primaryBtn}>
                Connect Google Drive
              </button>
            ) : null}
          </div>
        )}
      </section>

      {/* Schedule & retention */}
      <section className={card}>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">
          Schedule &amp; retention
        </h2>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={!canManage}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            Enable automatic backups
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className={label}>Frequency</span>
              <select
                className={input}
                value={form.scheduleKind}
                disabled={!canManage}
                onChange={(e) => update({ scheduleKind: e.target.value as ScheduleKind })}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="cron">Advanced (cron)</option>
              </select>
            </div>
            {form.scheduleKind === "cron" ? (
              <div>
                <span className={label}>Cron expression</span>
                <input
                  className={input}
                  value={form.cronExpr}
                  disabled={!canManage}
                  placeholder="0 3 * * *"
                  onChange={(e) => update({ cronExpr: e.target.value })}
                />
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className={label}>Retention</span>
              <select
                className={input}
                value={form.retentionMode}
                disabled={!canManage}
                onChange={(e) =>
                  update({ retentionMode: e.target.value as RetentionMode })
                }
              >
                <option value="simple">Simple (keep N days)</option>
                <option value="gfs">GFS (daily/weekly/monthly)</option>
              </select>
            </div>
            {form.retentionMode === "simple" ? (
              <div>
                <span className={label}>Keep for (days)</span>
                <input
                  type="number"
                  min={1}
                  className={input}
                  value={form.retentionDays}
                  disabled={!canManage}
                  onChange={(e) => update({ retentionDays: e.target.value })}
                />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className={label}>Daily</span>
                  <input
                    type="number"
                    min={0}
                    className={input}
                    value={form.gfsDaily}
                    disabled={!canManage}
                    onChange={(e) => update({ gfsDaily: e.target.value })}
                  />
                </div>
                <div>
                  <span className={label}>Weekly</span>
                  <input
                    type="number"
                    min={0}
                    className={input}
                    value={form.gfsWeekly}
                    disabled={!canManage}
                    onChange={(e) => update({ gfsWeekly: e.target.value })}
                  />
                </div>
                <div>
                  <span className={label}>Monthly</span>
                  <input
                    type="number"
                    min={0}
                    className={input}
                    value={form.gfsMonthly}
                    disabled={!canManage}
                    onChange={(e) => update({ gfsMonthly: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <span className={label}>Google Drive folder name</span>
            <input
              className={input}
              value={form.gdriveFolderName}
              disabled
              placeholder="Trello Clone Backups (env)"
              onChange={(e) => update({ gdriveFolderName: e.target.value })}
            />
            <p className="mt-1 text-xs text-slate-500">
              Backups are stored in this folder in the connected Drive. Each
              environment uses its own folder. (Editing is disabled for now.)
            </p>
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={form.includeMinio}
                disabled={!canManage}
                onChange={(e) => update({ includeMinio: e.target.checked })}
              />
              Include file storage (MinIO)
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={form.encryptionEnabled}
                disabled={!canManage}
                onChange={(e) => update({ encryptionEnabled: e.target.checked })}
              />
              Encrypt backups
            </label>
          </div>

          {canManage ? (
            <button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(toInput(form))}
              className={primaryBtn}
            >
              {saveMutation.isPending ? "Saving..." : "Save settings"}
            </button>
          ) : null}
        </div>
      </section>

      {/* Backups / Transactions */}
      <section className={card}>
        <div className="mb-4 flex items-center justify-between border-b border-slate-200">
          <div className="flex gap-2">
            {(
              [
                ["all", "All backups"],
                ["transactions", "Transactions"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                  tab === key
                    ? "border-indigo-600 text-indigo-700"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {status?.running ? (
            <span className="text-sm text-amber-700">A backup is running...</span>
          ) : null}
        </div>

        {tab === "all" ? (
          <AllBackupsTab
            upcoming={upcomingQuery.data?.runs ?? []}
            runs={(runsQuery.data ?? []).filter((r) => r.status === "success")}
            loading={runsQuery.isLoading}
            canManage={canManage}
            onDelete={setPendingDelete}
            onRestore={setRestoreFor}
          />
        ) : (
          <HistoryTable runs={runsQuery.data ?? []} loading={runsQuery.isLoading} />
        )}
      </section>

      {pendingDelete ? (
        <Modal title="Delete backup" onClose={() => setPendingDelete(null)}>
          <p className="text-sm text-slate-600">
            Delete <strong>{pendingDelete.fileName}</strong>? This removes the file
            from Google Drive and cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteMutation.isPending}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              onClick={() =>
                deleteMutation.mutate(
                  { runId: pendingDelete.id },
                  { onSuccess: () => setPendingDelete(null) },
                )
              }
            >
              Delete
            </button>
          </div>
        </Modal>
      ) : null}

      {restoreFor ? (
        <RestoreModal
          run={restoreFor}
          maintenanceOn={settings.maintenance}
          onClose={() => setRestoreFor(null)}
          onDone={invalidate}
        />
      ) : null}
    </div>
  );
}

// Upcoming scheduled runs (next 7 days) on top, then every successful backup
// (newest first) with restore/delete actions.
function AllBackupsTab({
  upcoming,
  runs,
  loading,
  canManage,
  onDelete,
  onRestore,
}: {
  upcoming: Date[];
  runs: BackupRun[];
  loading: boolean;
  canManage: boolean;
  onDelete: (r: BackupRun) => void;
  onRestore: (r: BackupRun) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          Upcoming (next 7 days)
        </h3>
        {upcoming.length === 0 ? (
          <p className="text-sm text-slate-500">
            No upcoming backups. Enable automatic backups above.
          </p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((d) => (
              <li
                key={new Date(d).toISOString()}
                className="flex items-center gap-3 text-sm text-slate-700"
              >
                <Badge color="bg-blue-100 text-blue-700">upcoming</Badge>
                {new Date(d).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          Successful backups
        </h3>
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-slate-500">No successful backups yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-700">{r.fileName}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    {new Date(r.startedAt).toLocaleString()} · {formatBytes(r.sizeBytes)}
                    <RunBadges run={r} />
                  </div>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 gap-3 text-sm">
                    <button
                      type="button"
                      className="font-medium text-indigo-600 hover:text-indigo-700"
                      onClick={() => onRestore(r)}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      className="font-medium text-red-600 hover:text-red-700"
                      onClick={() => onDelete(r)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Read-only audit log of every run (success / failed / running).
function HistoryTable({ runs, loading }: { runs: BackupRun[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-slate-500">Loading...</p>;
  if (runs.length === 0)
    return <p className="text-sm text-slate-500">No transactions yet.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate-600">
        <tr>
          <th className="py-2 font-medium">Started</th>
          <th className="py-2 font-medium">Labels</th>
          <th className="py-2 font-medium">Size</th>
          <th className="py-2 font-medium">File</th>
          <th className="py-2 font-medium">Expires</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} className="border-t border-slate-100">
            <td className="py-2 text-slate-700">
              {new Date(r.startedAt).toLocaleString()}
            </td>
            <td className="py-2">
              <RunBadges run={r} />
            </td>
            <td className="py-2 text-slate-700">{formatBytes(r.sizeBytes)}</td>
            <td className="py-2 text-slate-700">{r.fileName}</td>
            <td className="py-2 text-slate-700">
              {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl shadow-slate-900/10 ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
        <div className="mt-2">{children}</div>
        <button type="button" className="sr-only" onClick={onClose}>
          close
        </button>
      </div>
    </div>
  );
}

// Restore flow: confirm -> enforce maintenance -> restore -> offer to leave it.
function RestoreModal({
  run,
  maintenanceOn,
  onClose,
  onDone,
}: {
  run: BackupRun;
  maintenanceOn: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const toast = useToastStore((s) => s.add);
  const [step, setStep] = useState<"confirm" | "running" | "done">("confirm");

  const maintenance = useMutation(trpc.backup.maintenance.mutationOptions({}));
  const restore = useMutation(trpc.backup.restore.mutationOptions({}));

  async function run1() {
    try {
      if (!maintenanceOn) await maintenance.mutateAsync({ on: true });
      setStep("running");
      await restore.mutateAsync({ runId: run.id });
      toast("Restore completed.", "success");
      setStep("done");
      onDone();
    } catch (e) {
      toast(backupErrorMessage(e), "error");
      setStep("confirm");
    }
  }

  async function leaveMaintenance() {
    try {
      await maintenance.mutateAsync({ on: false });
    } finally {
      onDone();
      onClose();
    }
  }

  return (
    <Modal title="Restore backup" onClose={onClose}>
      {step === "confirm" ? (
        <>
          <p className="text-sm text-slate-600">
            Restoring <strong>{run.fileName}</strong> overwrites all current data.
            The app will be put into maintenance mode first.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              onClick={run1}
            >
              Restore
            </button>
          </div>
        </>
      ) : null}

      {step === "running" ? (
        <p className="text-sm text-slate-600">Restoring, please wait...</p>
      ) : null}

      {step === "done" ? (
        <>
          <p className="text-sm text-slate-600">
            Restore complete. The app is still in maintenance mode.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              onClick={() => {
                onDone();
                onClose();
              }}
            >
              Keep maintenance on
            </button>
            <button type="button" className={primaryBtn} onClick={leaveMaintenance}>
              Leave maintenance
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
