import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
