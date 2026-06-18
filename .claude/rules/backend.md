---
paths:
  - 'packages/backend/**/*'
---

## Required Library:

- typescript
- express
- @trpc/server + superjson
- kysely
- mjml + nodemailer + mailtrap
- pg (postgresql)
- zod
- bcryptjs
- dotenv
- swagger for api docs
- use in memory postgresql for testing

## Folder Structure: Feature-based structure

Follow the naming convention please

```txt
src/
  config/
    env.config.ts              # App-wide config, env config

  migrations/                  # Kysely migration files
    <increment>.<feature>.ts   # example: 001.migration.ts

  features/
    <feature>/
      test/
        <endpoint>.spec.ts      # integration test for each endpoint in router
      <feature>.service.ts     # Business logic
      <feature>.repo.ts        # Database access / Kysely queries
      <feature>.router.ts      # tRPC router for this feature

  scripts/                     # One-off scripts, seed scripts
    <script_name>.script.ts

  trpc/
    context.ts                 # tRPC context creation
    router.ts                  # Combine all feature routers
    trpc.ts                    # tRPC init, procedures, middleware

  index.ts                     # App entry point
```

## Note:

- frontend and backend are on same origin so no cors needed
- access token and refresh token are http only cookie, do not store them in local storage
