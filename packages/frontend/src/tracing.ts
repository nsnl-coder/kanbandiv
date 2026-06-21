// OTel web SDK: instruments fetch/XHR and injects W3C `traceparent` into API
// calls so FE and BE spans join one trace. Imported first in main.tsx.
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { config } from "./config/env.config";

// Inject traceparent on calls to our own backend. The tRPC client may live on a
// different origin (config.apiUrl), while client-log/OTLP stay same-origin.
const apiOrigin = (() => {
  try {
    return new URL(config.apiUrl, location.origin).origin;
  } catch {
    return location.origin;
  }
})();
const apiUrls = [
  new RegExp(`${location.origin}/(trpc|api)`),
  new RegExp(`${apiOrigin}/(trpc|api)`),
];

// Browser can't reach internal tempo:4318 -> ship to the public nginx /otlp path.
// No endpoint (local) -> no exporter: keep the console clean (don't spam spans).
const spanProcessors = config.otelEndpoint
  ? [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${config.otelEndpoint}/v1/traces` }),
      ),
    ]
  : [];

const provider = new WebTracerProvider({
  resource: resourceFromAttributes({
    "service.name": "frontend",
    "deployment.environment": config.appEnv,
  }),
  spanProcessors,
});

provider.register({ contextManager: new ZoneContextManager() });

registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({ propagateTraceHeaderCorsUrls: apiUrls }),
    new XMLHttpRequestInstrumentation({ propagateTraceHeaderCorsUrls: apiUrls }),
  ],
});
