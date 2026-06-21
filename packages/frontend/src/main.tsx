// OTel + Sentry first, before app code, so fetch/XHR are instrumented.
import "./tracing";
import "./sentry";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { queryClient } from "./lib/query-client";
import { TRPCProvider, trpcClient } from "./lib/trpc";
import { applyTheme, useThemeStore } from "./hooks/useThemeStore";
import "./index.css";

// Apply the stored theme before first paint to avoid a flash of the wrong theme.
applyTheme(useThemeStore.getState().theme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TRPCProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
