# Command Palette + Keyboard Shortcuts — Backend Plan

**No backend changes required.**

## Rationale
The command palette is a pure client-side action launcher and the keyboard
shortcuts are a client-side input layer. Every action it runs is already served by
existing endpoints or is client-only:

- **Navigate**: client-side `react-router` navigation (`/projects`, `/projects/new`,
  `/projects/:id`, `/projects/:id/boards/:boardId`, `/admin`). No API call.
- **New board**: there is NO board-create route or endpoint to call from the
  palette; board creation is an in-page MODAL on the project page
  (`ProjectDetailPage`). The "New board" command merely NAVIGATES to
  `/projects/:id`. No API call from this feature.
- **Project list** (for navigate-to-project commands): reuses the EXISTING
  `trpc.projects.list` (already consumed in `Sidebar.tsx:34` and
  `SearchPalette.tsx:54`).
- **Board actions** (switch view, archived, history, labels, clear filters, new
  card): invoke EXISTING `BoardDetailPage` flows / endpoints via the in-page handler
  bridge. View persistence uses the existing `trpc.boardViews.set`
  (`board-view.router.ts:21`); "New card" uses the existing `trpc.cards.create`
  (`card.router.ts:28`, input `{ columnId, title }`). No new endpoints.
- **Log out**: EXISTING `trpc.auth.logout` (`auth.router.ts:123`, via `useLogout`).
- **Search entry**: opens the existing `SearchPalette` (`trpc.search.cards`).

No new endpoints, schemas, migrations, or shared types. The feature ships entirely
in `packages/frontend`.

## API endpoints added
None.
