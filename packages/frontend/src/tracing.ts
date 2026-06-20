// OTel web SDK: instruments fetch/XHR and injects W3C `traceparent` into API
// calls so FE and BE spans join one trace. Imported first in main.tsx.
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { config } from "./config/env.config";

// Same-origin API; inject traceparent on calls to our own backend.
const apiUrls = [new RegExp(`${location.origin}/(trpc|api)`)];

// Browser can't reach internal tempo:4318 -> ship to the public nginx /otlp path.
// No endpoint (local) -> print spans to the console instead.
const exporter = config.otelEndpoint
  ? new OTLPTraceExporter({ url: `${config.otelEndpoint}/v1/traces` })
  : new ConsoleSpanExporter();

const provider = new WebTracerProvider({
  resource: resourceFromAttributes({
    "service.name": "frontend",
    "deployment.environment": config.appEnv,
  }),
  spanProcessors: [new BatchSpanProcessor(exporter)],
});

provider.register({ contextManager: new ZoneContextManager() });

registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({ propagateTraceHeaderCorsUrls: apiUrls }),
    new XMLHttpRequestInstrumentation({ propagateTraceHeaderCorsUrls: apiUrls }),
  ],
});
