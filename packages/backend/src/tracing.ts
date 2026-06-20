// MUST be imported at the very top of the entrypoint (before express/pg/http),
// so OTel auto-instrumentation can patch those modules before they are used.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  ConsoleSpanExporter,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";

const vpsEnv = process.env.VPS_ENV ?? "local";
// Derive NODE_ENV (library mode) from the single VPS_ENV knob, before express/pg
// are imported - so we never have to set NODE_ENV by hand anywhere.
process.env.NODE_ENV = vpsEnv === "local" ? "development" : "production";

const hasTempo = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
// 1.0 local/dev, ~0.1 prod. 100% spans at prod traffic is costly; head-sample
// here until a central OTel Collector exists.
const ratio = vpsEnv === "prod" ? 0.1 : 1;

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    "service.name": "backend",
    "deployment.environment": vpsEnv,
  }),
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
  // Local: print spans to stdout. VPS: ship to Tempo (OTLP HTTP 4318).
  traceExporter: hasTempo
    ? new OTLPTraceExporter()
    : new ConsoleSpanExporter(),
  // OTel metrics on :9464 only on VPS; skip the extra server locally.
  metricReader: hasTempo ? new PrometheusExporter({ port: 9464 }) : undefined,
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Flush spans on shutdown so the last requests are not lost.
process.on("SIGTERM", () => {
  void sdk.shutdown().finally(() => process.exit(0));
});
