import { env } from "../../config/env.config.js";

// Read-only Prometheus query proxy for the admin Monitor tab. The set of PromQL
// expressions is a FIXED server-side allowlist - the client never sends PromQL,
// so this can't be turned into an arbitrary query/SSRF surface.

export interface MetricPanel {
  id: string;
  title: string;
  unit: "percent" | "bytes" | "rps" | "ms" | "count";
  /** PromQL evaluated via query_range. May return one or many series. */
  expr: string;
  /** Label whose value names each series in a multi-series panel. */
  legendLabel?: string;
}

// Curated to what this stack exports (backend OTel :9464, node-exporter, cAdvisor,
// Prometheus self). Expressions that match nothing simply return empty series.
export const PANELS: readonly MetricPanel[] = [
  {
    id: "request_rate",
    title: "Request rate",
    unit: "rps",
    expr: "sum(rate(http_server_duration_milliseconds_count[5m]))",
  },
  {
    id: "error_rate",
    title: "5xx error rate",
    unit: "percent",
    expr:
      "sum(rate(http_server_duration_milliseconds_count{http_status_code=~\"5..\"}[5m])) " +
      "/ clamp_min(sum(rate(http_server_duration_milliseconds_count[5m])), 1)",
  },
  {
    id: "latency_p95",
    title: "Latency p95",
    unit: "ms",
    expr:
      "histogram_quantile(0.95, sum(rate(http_server_duration_milliseconds_bucket[5m])) by (le))",
  },
  {
    id: "targets_up",
    title: "Targets up",
    unit: "count",
    expr: "sum(up)",
  },
  {
    id: "host_cpu",
    title: "Host CPU",
    unit: "percent",
    expr: "1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m]))",
  },
  {
    id: "host_mem",
    title: "Host memory",
    unit: "percent",
    expr: "1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes",
  },
  {
    id: "container_cpu",
    title: "Container CPU",
    unit: "percent",
    expr: "rate(container_cpu_usage_seconds_total{name!=\"\"}[5m])",
    legendLabel: "name",
  },
  {
    id: "container_mem",
    title: "Container memory",
    unit: "bytes",
    expr: "container_memory_usage_bytes{name!=\"\"}",
    legendLabel: "name",
  },
] as const;

export interface MetricPoint {
  t: number; // unix seconds
  v: number | null; // null when Prometheus reports NaN/missing
}
export interface MetricSeries {
  name: string;
  points: MetricPoint[];
}
export interface PanelResult {
  id: string;
  title: string;
  unit: MetricPanel["unit"];
  series: MetricSeries[];
}

interface PromMatrix {
  status: string;
  data?: { resultType: string; result: { metric: Record<string, string>; values: [number, string][] }[] };
}

function seriesName(metric: Record<string, string>, legendLabel?: string): string {
  if (legendLabel && metric[legendLabel]) return metric[legendLabel];
  return metric.job ?? metric.instance ?? "value";
}

async function queryRange(
  expr: string,
  startSec: number,
  endSec: number,
  stepSec: number,
): Promise<PromMatrix["data"]> {
  const url = new URL(`${env.PROMETHEUS_URL}/api/v1/query_range`);
  url.searchParams.set("query", expr);
  url.searchParams.set("start", String(startSec));
  url.searchParams.set("end", String(endSec));
  url.searchParams.set("step", String(stepSec));
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return undefined;
  const body = (await res.json()) as PromMatrix;
  return body.status === "success" ? body.data : undefined;
}

/** Run the whole allowlist over the last `rangeMinutes`. Empty when no PROMETHEUS_URL. */
export async function fetchOverview(rangeMinutes: number): Promise<PanelResult[]> {
  if (!env.PROMETHEUS_URL) return [];
  const endSec = Math.floor(Date.now() / 1000);
  const startSec = endSec - rangeMinutes * 60;
  // ~120 points per panel regardless of window.
  const stepSec = Math.max(15, Math.floor((rangeMinutes * 60) / 120));

  const results = await Promise.all(
    PANELS.map(async (panel): Promise<PanelResult> => {
      const data = await queryRange(panel.expr, startSec, endSec, stepSec).catch(() => undefined);
      const series: MetricSeries[] = (data?.result ?? []).map((r) => ({
        name: seriesName(r.metric, panel.legendLabel),
        points: r.values.map(([t, v]) => ({ t, v: Number.isNaN(Number(v)) ? null : Number(v) })),
      }));
      return { id: panel.id, title: panel.title, unit: panel.unit, series };
    }),
  );
  return results;
}
