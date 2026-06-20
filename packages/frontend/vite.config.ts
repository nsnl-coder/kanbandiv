import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// Token only present in CI/Docker build; local builds skip upload.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryRelease = process.env.SENTRY_RELEASE;

export default defineConfig({
  // Emit source maps so Sentry can de-minify stack traces. The Sentry plugin
  // uploads them then deletes them from dist (filesToDeleteAfterUpload), so they
  // are never served to the browser. The Dockerfile also strips any leftover .map.
  build: { sourcemap: true },
  plugins: [
    react(),
    tailwindcss(),
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: "that-nails-tech",
            project: "javascript-react",
            url: "https://us.sentry.io",
            authToken: sentryAuthToken,
            telemetry: false,
            release: sentryRelease ? { name: sentryRelease } : undefined,
            sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
          }),
        ]
      : []),
  ],
  server: {
    // Pin the port so the dev origin never drifts (5173 -> 5174 -> ...). A
    // stale tab on an old port talking to a proxy on a new port is what shows
    // up as an intermittent "CORS" error. strictPort fails loudly instead.
    port: 5173,
    strictPort: true,
    proxy: {
      "/trpc": {
        target: "http://localhost:4000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            // Backend down / mid-restart: surface it clearly instead of a
            // confusing browser-side failure.
            console.error("[proxy] /trpc ->", err.message);
            if (res && "writeHead" in res && !res.headersSent) {
              res.writeHead(502, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "backend unavailable" }));
            }
          });
        },
      },
    },
  },
});
