import {
  createTRPCClient,
  httpBatchLink,
  TRPCClientError,
  type TRPCLink,
} from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import { AuthError } from "shared";
import type { AppRouter } from "backend/src/trpc/router.js";
import { config } from "../config/env.config";
import { authStore } from "../hooks/useAuthStore";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

// Refresh-retry only on an expired access token. The backend tags that exact
// case with SESSION_EXPIRED; domain UNAUTHORIZED errors (bad credentials, wrong
// current password) use other messages, so a failed login never triggers a
// refresh. No path-based denylist to keep in sync.
function shouldRefreshRetry(err: unknown): boolean {
  return (
    err instanceof TRPCClientError &&
    err.data?.code === "UNAUTHORIZED" &&
    err.message === AuthError.SESSION_EXPIRED &&
    authStore.isAuthenticated()
  );
}

// Single in-flight refresh shared across all callers (the retry link plus the
// on-mount refreshes in ProtectedRoute/GuestRoute, which StrictMode fires
// twice). The refresh token rotates server-side, so two concurrent refreshes
// with the same cookie revoke the family - dedup keeps it to one request.
let inFlightRefresh: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  if (!inFlightRefresh) {
    inFlightRefresh = refreshClient.auth.refresh
      .mutate({})
      .then((user) => {
        authStore.setAuth(user);
        return true;
      })
      .catch(() => {
        authStore.clearAuth();
        return false;
      })
      .finally(() => {
        inFlightRefresh = null;
      });
  }
  return inFlightRefresh;
}

// On UNAUTHORIZED, refresh once and retry the original op. The refresh call
// itself is excluded to avoid an infinite loop.
const refreshLink: TRPCLink<AppRouter> = () => {
  return ({ op, next }) => {
    type Value = Parameters<
      NonNullable<Parameters<ReturnType<typeof next>["subscribe"]>[0]["next"]>
    >[0];
    return observable<Value, TRPCClientError<AppRouter>>((observer) => {
      let retried = false;
      const subscribe = () =>
        next(op).subscribe({
          next: (v) => observer.next(v),
          complete: () => observer.complete(),
          error: (err) => {
            if (!retried && shouldRefreshRetry(err)) {
              retried = true;
              refreshSession().then((ok) => {
                if (ok) {
                  subscribe();
                } else {
                  // refreshSession already cleared the store; the route guards
                  // redirect to /login with the current path as ?next=. Just
                  // surface the error to the caller (no hard reload).
                  observer.error(err);
                }
              });
              return;
            }
            observer.error(err);
          },
        });
      const sub = subscribe();
      return () => sub.unsubscribe();
    });
  };
};

const terminalLink = httpBatchLink({
  url: config.apiUrl,
  transformer: superjson,
  // Access + refresh tokens travel as httpOnly cookies; credentials:'include'
  // sends them. No Authorization header (the token isn't readable by JS).
  // x-requested-with is the CSRF marker the backend requires on mutations; a
  // cross-site attacker cannot set it without a (failing) CORS preflight.
  headers: () => ({ "x-requested-with": "XMLHttpRequest" }),
  fetch: (url, opts) => fetch(url, { ...opts, credentials: "include" }),
});

// Plain client used only for the refresh call, to avoid recursive links.
const refreshClient = createTRPCClient<AppRouter>({
  links: [terminalLink],
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [refreshLink, terminalLink],
});
