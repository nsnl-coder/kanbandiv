import { config } from "../../../config/env.config";

// Full-page navigation to the backend OAuth start route (not a tRPC call): the
// flow is server-driven 302 redirects through Google and back into the SPA.
// MUST target the API host (config.apiBaseUrl): the OAuth callback sets the
// host-only session cookies there, which is where tRPC reads them. On dev the
// API is a separate subdomain, so GOOGLE_REDIRECT_URI must point at that same
// API host (not the app host) or the state cookie / session cookies land on the
// wrong origin.
export function GoogleButton({ label }: { label: string }) {
  const href = `${config.apiBaseUrl}/auth/oauth/google`;
  return (
    <a
      href={href}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground/90 transition hover:bg-foreground/5"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
        />
        <path
          fill="#FBBC05"
          d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.06l3.01-2.34Z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
        />
      </svg>
      {label}
    </a>
  );
}
