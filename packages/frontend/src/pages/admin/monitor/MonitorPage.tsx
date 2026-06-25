import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Boxes,
  Container,
  Database,
  ExternalLink,
  HardDrive,
  LineChart as LineChartIcon,
  type LucideIcon,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTRPC } from "../../../lib/trpc";
import { config } from "../../../config/env.config";

interface MetricPoint {
  t: number;
  v: number | null;
}
interface MetricSeries {
  name: string;
  points: MetricPoint[];
}
interface PanelResult {
  id: string;
  title: string;
  unit: "percent" | "bytes" | "rps" | "ms" | "count";
  series: MetricSeries[];
}

const RANGES = [
  { label: "30m", minutes: 30 },
  { label: "3h", minutes: 180 },
  { label: "6h", minutes: 360 },
] as const;

function formatValue(v: number, unit: PanelResult["unit"]): string {
  switch (unit) {
    case "percent":
      return `${(v * 100).toFixed(1)}%`;
    case "bytes": {
      const u = ["B", "KB", "MB", "GB", "TB"];
      let n = v;
      let i = 0;
      while (n >= 1024 && i < u.length - 1) {
        n /= 1024;
        i++;
      }
      return `${n.toFixed(1)} ${u[i]}`;
    }
    case "rps":
      return `${v.toFixed(2)}/s`;
    case "ms":
      return `${v.toFixed(0)} ms`;
    default:
      return v.toFixed(0);
  }
}

// Merge a panel's series into recharts rows keyed by timestamp.
function toRows(panel: PanelResult): { rows: Record<string, number | null>[]; keys: string[] } {
  const byTime = new Map<number, Record<string, number | null>>();
  const keys: string[] = [];
  for (const s of panel.series) {
    keys.push(s.name);
    for (const p of s.points) {
      const row = byTime.get(p.t) ?? { t: p.t };
      row[s.name] = p.v;
      byTime.set(p.t, row);
    }
  }
  const rows = [...byTime.values()].sort((a, b) => (a.t as number) - (b.t as number));
  return { rows, keys };
}

const LINE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4", "#a855f7"];

function MetricCard({ panel }: { panel: PanelResult }) {
  const { rows, keys } = useMemo(() => toRows(panel), [panel]);
  const latest = panel.series[0]?.points.at(-1)?.v ?? null;
  const single = panel.series.length <= 1;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground/80">{panel.title}</span>
        {single && latest != null && (
          <span className="text-sm font-semibold text-foreground">
            {formatValue(latest, panel.unit)}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-xs text-muted">
          No data (metric not exported)
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="t"
              tickFormatter={(t: number) =>
                new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              }
              tick={{ fontSize: 10 }}
              minTickGap={32}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => formatValue(v, panel.unit)}
              width={48}
            />
            <Tooltip
              labelFormatter={(t) => new Date((t as number) * 1000).toLocaleString()}
              formatter={(v) => formatValue(Number(v), panel.unit)}
            />
            {keys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

interface ConsoleCard {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

function consoleCards(): ConsoleCard[] {
  const c = config.opsConsoles;
  if (!c) return [];
  return [
    { href: c.grafana, label: "Grafana", hint: "Metrics, logs & traces", icon: LineChartIcon },
    { href: c.prometheus, label: "Prometheus", hint: "Raw metrics & targets", icon: Activity },
    { href: c.cadvisor, label: "cAdvisor", hint: "Live container stats", icon: Boxes },
    { href: c.minio, label: "MinIO", hint: "Object storage console", icon: HardDrive },
    { href: c.redis, label: "RedisInsight", hint: "Cache & realtime bus", icon: Database },
    { href: c.pgadmin, label: "pgAdmin", hint: "Postgres admin", icon: Database },
    { href: c.portainer, label: "Portainer", hint: "Docker management", icon: Container },
  ];
}

export function MonitorPage() {
  const trpc = useTRPC();
  const [minutes, setMinutes] = useState(30);
  const overview = useQuery({
    ...trpc.monitoring.overview.queryOptions({ rangeMinutes: minutes }),
    refetchInterval: 15000,
  });
  const panels = (overview.data ?? []) as PanelResult[];
  const cards = consoleCards();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Monitor</h1>
          <p className="text-sm text-muted">System metrics and ops consoles.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.minutes}
              type="button"
              onClick={() => setMinutes(r.minutes)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                minutes === r.minutes
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {panels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
          {overview.isLoading ? "Loading metrics..." : "Metrics unavailable in this environment."}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {panels.map((p) => (
            <MetricCard key={p.id} panel={p} />
          ))}
        </div>
      )}

      {cards.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Ops consoles
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <a
                key={card.href}
                href={card.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition hover:border-indigo-300 hover:bg-surface-muted"
              >
                <card.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted group-hover:text-indigo-600" />
                <span className="flex flex-1 flex-col leading-tight">
                  <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                    {card.label}
                    <ExternalLink className="h-3 w-3 text-muted" />
                  </span>
                  <span className="text-xs text-muted">{card.hint}</span>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
