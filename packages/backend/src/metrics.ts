import {
  Registry,
  collectDefaultMetrics,
  Histogram,
} from "prom-client";
import type { RequestHandler } from "express";

// prom-client registry: default process metrics + our request histogram.
// Kept on the same express app; Prometheus scrapes it over the internal network
// only (never exposed through public nginx).
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  registers: [registry],
});

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    // Use the matched route pattern when available to keep label cardinality low.
    const route = req.route?.path ?? req.path;
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
};

export const metricsHandler: RequestHandler = async (_req, res) => {
  res.setHeader("Content-Type", registry.contentType);
  res.send(await registry.metrics());
};
