---
paths:
  - 'packages/frontend/**/*'
---

# important rules:

## Required library:

- vite
- typescript
- reactjs
- @trpc/client + superjson
- @tanstack/query
- react-hook-form
- zod
- tailwindcss
- vitest for unit testing
- zustand
- @tanstack/react-table
- lucide-react
- shadcn/ui
- Radix UI
- @radix-ui/react-dialog, @radix-ui/react-dropdown-menu, @radix-ui/react-popover, @radix-ui/react-select, @radix-ui/react-tabs, @radix-ui/react-toast

## Install if needed:

- socket.io-client
- @dnd-kit/core
- framer-motion

## React Folder Structure: Feature-based

This project uses a **feature-based structure** for React.

```txt
src/
  config/
    env.config.ts              # App-wide config, env variables

  features/
    <feature>/
      components/              # Components used only by this feature
      hooks/                   # Feature-specific hooks
      types.ts                 # Feature-specific types
      utils.ts                 # Feature-specific helpers
  pages/                       # mimic the routes that are organize by roles
    admin                      # contain pages that only admin can access
    user                       # page for user

  components/                  # shared components between features
  hooks/                       # Shared hooks used by many features
  lib/
    trpc.ts                    # tRPC client
    query-client.ts            # TanStack Query client
    utils.ts                   # Shared utilities

  styles/
    globals.css                # Global CSS / Tailwind imports
  App.tsx                     # Root app component
  main.tsx                     # Vite React entry point
  index.css                    # import tailwindcss
```

E2E tests live outside this package in `e2e/frontend/<feature>/<flow>.e2e.spec.ts` (own workspace package `e2e-frontend`).

## Coding rules:

- Always use typescript & at strict mode
- Always use @trpc/client to call backend
- Do not create hook for api call - just use `<useQuery | useMutation>(trpc.<feature>.<endpoint>.queryOptions())` directly in components
- access token and refresh token are http only cookie, do not store them in local storage
- prefer to use modal over new route, ask if not sure

## Testing rule

- e2e tests are real (non-mocked): they drive the LIVE deployed site (dev/prod domain, `E2E_BASE_URL`) as a pre-seeded test user. No DB/network mocking, no separate test DB
- OTP flows read codes from the Mailtrap sandbox (dev + prod both use it); destructive flows use throwaway sign-up emails / a dedicated reset account
- e2e tests live in `e2e/frontend/`, not in this package. They target the public URL, so run them anywhere (locally, VPS, or CI) with Playwright directly - **no Docker**. Locally: `npx playwright install chromium` once, set the `E2E_*` env vars, then `pnpm --filter e2e-frontend e2e`
- unit tests (vitest) stay in this package
