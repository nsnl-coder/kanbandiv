import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type BugReport,
  type BugSeverityValue,
  type BugStatusValue,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import {
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  severityList,
  statusList,
} from "../../../features/bug-report/utils";
import { bugReportErrorMessage } from "../../../features/bug-report/errors";
import { BugReportDetailModal } from "./BugReportDetailModal";

const PAGE_SIZE = 20;

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-border/70">
      <div className="h-11 border-b border-border bg-canvas/80" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-t border-border px-4 py-3">
          <div className="h-3 w-48 animate-pulse rounded bg-surface-muted" />
          <div className="ml-auto h-3 w-16 animate-pulse rounded bg-surface-muted" />
          <div className="h-6 w-28 animate-pulse rounded bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}

export function BugReportsPage() {
  const trpc = useTRPC();

  const [status, setStatus] = useState<BugStatusValue | "">("");
  const [severity, setSeverity] = useState<BugSeverityValue | "">("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<BugReport | null>(null);

  const listQuery = useQuery(
    trpc.bugReports.list.queryOptions({
      status: status || undefined,
      severity: severity || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
  );

  const items = listQuery.data?.items ?? [];
  const nextOffset = listQuery.data?.nextOffset ?? null;

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Bugs</h1>
        <p className="mt-1 text-sm text-muted">Review and triage reported bugs.</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as BugStatusValue | "");
            setOffset(0);
          }}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {statusList.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by severity"
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value as BugSeverityValue | "");
            setOffset(0);
          }}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="">All severities</option>
          {severityList.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {listQuery.error ? (
        <p className="mb-2 text-sm text-red-600">{bugReportErrorMessage(listQuery.error)}</p>
      ) : null}

      {listQuery.isLoading ? (
        <TableSkeleton />
      ) : (
        <table className="w-full overflow-hidden rounded-xl bg-surface text-sm shadow-sm ring-1 ring-border/70">
          <thead className="border-b border-border bg-canvas/80 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Title</th>
              <th className="px-4 py-3 font-semibold">Severity</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Reporter</th>
              <th className="px-4 py-3 font-semibold">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr
                key={b.id}
                onClick={() => setSelected(b)}
                className="cursor-pointer border-t border-border text-foreground/80 transition-colors hover:bg-canvas/60"
              >
                <td className="px-4 py-2 font-medium text-foreground">{b.title}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE[b.severity]}`}>
                    {SEVERITY_LABEL[b.severity]}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[b.status]}`}>
                    {STATUS_LABEL[b.status]}
                  </span>
                </td>
                <td className="px-4 py-2 break-all">{b.reporterEmail ?? "-"}</td>
                <td className="px-4 py-2">{b.createdAt.toLocaleDateString()}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted">
                  No bug reports match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      <div className="mt-4 flex items-center gap-3 text-sm">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground/80 hover:bg-surface-muted disabled:opacity-50"
        >
          Previous
        </button>
        <span className="text-muted">
          {items.length === 0 ? 0 : offset + 1}-{offset + items.length}
        </span>
        <button
          type="button"
          disabled={nextOffset === null}
          onClick={() => setOffset(nextOffset ?? offset)}
          className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground/80 hover:bg-surface-muted disabled:opacity-50"
        >
          Next
        </button>
      </div>

      {selected ? (
        <BugReportDetailModal
          report={selected}
          open={selected !== null}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
