---
paths:
  - 'packages/frontend/**/*'
---

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
e2e/                         # End-to-end tests
  <feature>/
    <flow-name>.e2e.spec.ts        # E2E tests for this feature
  App.tsx                     # Root app component
  main.tsx                     # Vite React entry point
  index.css                    # import tailwindcss
```

## Coding rules:

- Always use typescript & at strict mode
- Always use @trpc/client to call backend
- Do not create hook for api call - just use `<useQuery | useMutation>(trpc.<feature>.<endpoint>.queryOptions())` directly in components
- access token and refresh token are http only cookie, do not store them in local storage

## Testing rule

- never call real db on e2e test, always mock the db calls
- only call real db on mcp test
