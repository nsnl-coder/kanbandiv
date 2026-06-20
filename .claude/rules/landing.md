---
paths:
  - 'packages/landing/**/*'
---

# Important rules:

- Do not use this Next.js app as a backend, only for public SEO page
- Run as nodejs server, not a static vite build

## Required library

- nextjs
- typescript
- tailwindcss
- zod
- superjson
- @tanstack/query
- react-hook-form
- lucide-react
- shadcn/ui
- Radix UI
- @radix-ui/react-dialog
- @radix-ui/react-dropdown-menu
- @radix-ui/react-popover
- @radix-ui/react-select
- @radix-ui/react-tabs
- @radix-ui/react-toast
- vitest for unit testing
- playwright for e2e testing

## Install if needed

- @trpc/client
- @trpc/react-query
- socket.io-client
- framer-motion
- next-sitemap
- next-intl
- @vercel/og

## Next.js purpose in this project

This Next.js app is used for public SEO pages, not the main dashboard app.

Use Next.js for:

- Landing page
- Pricing page
- Blog pages
- Public salon pages
- SEO metadata
- Open Graph metadata
- Sitemap
- Public marketing content

Backend business logic must stay in the backend app.
Main dashboard / owner app / staff app should stay in the React Vite app.

## Rendering rules

This project uses Next.js App Router.
Default to Server Components.

Use Client Components only when the component needs:

- `useState`
- `useEffect`
- `useRef`
- `onClick`
- `onChange`
- browser APIs like `window`, `document`, `localStorage`
- React Hook Form
- Zustand
- TanStack Query hooks
- interactive Radix UI components
- modals, dropdowns, popovers, tabs, toast, carousel, drag/drop

Do not add `"use client"` to an entire page unless the whole page truly needs client-side interactivity.

## Static, cached, and dynamic route rules

- Use static or cached rendering for public SEO pages.
- Use dynamic rendering only when the route depends on request-specific data.

### Static pages

Use static rendering for pages that rarely change:

- Home landing page
- About page
- Terms page
- Privacy page
- Static marketing sections

### Cached / revalidated pages

Use revalidate for public data that changes sometimes but does not need realtime updates:

- Pricing page
- Salon public profile
- Service menu
- Business hours
- Blog article
- Public staff list
- Public gallery

Example:

```tsx
export const revalidate = 300;
```

or:

```tsx
await fetch(url, {
  next: {
    revalidate: 300,
    tags: [`salon:${slug}:profile`],
  },
});
```

### Dynamic routes

Use dynamic rendering only for:

- request-specific data
- cookies
- headers
- authenticated user data
- private dashboard pages
- payment status
- admin-only data
- data that must be fresh on every request

Example:

```tsx
export const dynamic = 'force-dynamic';
```

or:

```tsx
await fetch(url, {
  cache: 'no-store',
});
```

## Cache and invalidation rules

- Use both time-based revalidation and manual invalidation for public SEO data.
- Time-based revalidation is the safety net.
- Manual invalidation updates data faster when the user changes something.

### Use tags for data cache

Use clear and consistent cache tags:

```txt
salon:${slug}
salon:${slug}:profile
salon:${slug}:services
salon:${slug}:hours
salon:${slug}:gallery
blog:${slug}
pricing
```

Example:

```tsx
await fetch(`${process.env.API_URL}/public/salons/${slug}`, {
  next: {
    revalidate: 300,
    tags: [`salon:${slug}:profile`],
  },
});
```

### Use path invalidation for page output

When public page data changes, invalidate both data tag and path when appropriate.

Example:

```ts
revalidateTag(`salon:${slug}:services`);
revalidatePath(`/salons/${slug}`);
```

Mental model:

```txt
revalidateTag()
→ invalidate data cache

revalidatePath()
→ invalidate route/page output cache
```

Do not use route cache for live/realtime data.

For live wait time, current queue count, active staff status, or notification badge, use Client Component fetch, polling, SSE, or WebSocket.

## API calling rules

The backend app is the source of truth.

Use the backend for:

- auth
- permissions
- payments
- SMS
- staff turn logic
- appointment booking logic
- database access
- business rules

For public SEO pages, prefer backend public endpoints that work well with Next.js `fetch`, cache, revalidate, and tags.

Example:

```tsx
await fetch(`${process.env.API_URL}/public/salons/${slug}`, {
  next: {
    revalidate: 300,
    tags: [`salon:${slug}:profile`],
  },
});
```

Use tRPC client only when it makes sense.
Do not use TanStack Query hooks inside Server Components.
TanStack Query hooks are only for Client Components.

## Environment rules

Create a typed env module.
Do not read `process.env` randomly across the app.

Use:

```txt
src/config/env.config.ts
```

Required env examples:

```env
API_URL=https://api.thatnails.com
NEXT_PUBLIC_APP_URL=https://app.thatnails.com
NEXT_PUBLIC_SITE_URL=https://thatnails.com
REVALIDATE_SECRET=secret_here
```

Rules:

- Never commit real `.env` files.
- Do not expose secrets with `NEXT_PUBLIC_`.
- Only public browser-safe values can use `NEXT_PUBLIC_`.

## Next.js Folder Structure: Large App

This project uses a large-app feature-based structure for Next.js App Router.

```txt
src/
  app/
    layout.tsx                  # Root layout
    page.tsx                    # Home landing page
    globals.css                 # Global CSS / Tailwind imports

    pricing/
      page.tsx                  # Pricing page

    salons/
      [slug]/
        page.tsx                # Public salon page
        loading.tsx
        error.tsx
        not-found.tsx

    blog/
      page.tsx                  # Blog listing
      [slug]/
        page.tsx                # Blog article
        loading.tsx
        error.tsx
        not-found.tsx

    api/
      revalidate/
        route.ts                # Revalidate endpoint for backend webhook

    sitemap.ts                  # Dynamic sitemap
    robots.ts                   # Robots config
    not-found.tsx               # Global 404

  config/
    env.config.ts               # Typed env variables
    site.config.ts              # Site metadata, URLs, brand config
    nav.config.ts               # Navigation config

  features/
    home/
      components/
        hero-section.tsx
        feature-section.tsx
        cta-section.tsx
      data/
        home-copy.ts

    pricing/
      components/
        pricing-card.tsx
        pricing-table.tsx
      api/
        get-pricing.ts
      types.ts

    salons/
      components/
        salon-info.tsx
        service-list.tsx
        business-hours.tsx
        booking-button.tsx
        current-wait-time-client.tsx
      api/
        get-salon-profile.ts
        get-salon-services.ts
        get-business-hours.ts
      types.ts
      utils.ts

    blog/
      components/
        blog-card.tsx
        blog-content.tsx
      api/
        get-post.ts
        get-posts.ts
      types.ts
      utils.ts

    seo/
      metadata/
        build-metadata.ts
        build-open-graph.ts
      components/
        json-ld.tsx

  components/
    ui/                         # shadcn/ui components
    layout/
      header.tsx
      footer.tsx
      mobile-menu.tsx
    shared/
      logo.tsx
      container.tsx
      section-heading.tsx

  lib/
    api/
      fetcher.ts                # Shared server fetch helper
      public-api.ts             # Public backend API helpers
    cache/
      tags.ts                   # Cache tag helpers
      revalidate.ts             # Revalidation helpers
    trpc/
      client.ts                 # Only if tRPC is needed
    query/
      query-client.ts           # Only for Client Components
    utils.ts

  hooks/
    use-media-query.ts          # Client-only shared hooks
    use-mounted.ts              # Client-only shared hooks

  styles/
    globals.css

  test/
    setup.ts
    render-with-providers.tsx
    mocks/
      handlers.ts
      server.ts
```

## Feature folder rules

Each feature should contain its own:

- components
- api helpers
- types
- utils
- feature-specific constants

Do not put feature-specific code in shared folders.
Shared folders are only for code used by many features.

## Route rules

Routes live in `src/app`.
Business UI and logic should live in `src/features`.
Keep route files thin.

Good:

```tsx
// app/salons/[slug]/page.tsx
import { SalonPage } from '@/features/salons/components/salon-page';

export default async function Page({ params }: Props) {
  const { slug } = await params;

  return <SalonPage slug={slug} />;
}
```

Avoid putting large UI directly inside route files.

## Metadata and SEO rules

Every public page should have proper metadata.
Use static metadata for static pages.
Use `generateMetadata()` for dynamic pages like salon and blog pages.

Public salon page should include:

- title
- description
- canonical URL
- Open Graph title
- Open Graph description
- Open Graph image if available

Example:

```tsx
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const salon = await getSalonProfile(slug);

  return {
    title: `${salon.name}`,
    description: salon.description,
  };
}
```

Add JSON-LD where useful for local business SEO.

## Client Component rules

Client Components should be small and isolated.

Use Client Components for:

- mobile menu
- modal
- dropdown
- popover
- tabs
- toast
- live wait time
- booking widget
- interactive form
- client-side analytics event

Do not pass sensitive data to Client Components.
Do not fetch private server-only data in Client Components unless it is safe and intended.

## Form rules

Use React Hook Form + Zod for interactive forms.

Forms that are SEO/static content should remain simple.

Forms that mutate backend data should call backend APIs.

Do not put core business logic in the form component.

## State management rules

Do not use Zustand for simple local UI state.
Use `useState` for local component state.
Use Zustand only for cross-component client state that is truly shared.
Do not use Zustand inside Server Components.

## Styling rules

Use Tailwind CSS.
Use shadcn/ui for base UI components.
Use Radix UI for accessible primitives.
Keep UI components reusable and composable.
Do not hard-code repeated class strings when a shared component is better.

## Testing rules

Use Vitest for unit tests.
Use React Testing Library for component tests.
Use Playwright for e2e tests
For component tests, mock API responses.
Do not call production APIs in tests.
Do not rely on real production data.
