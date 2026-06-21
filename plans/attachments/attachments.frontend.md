# Attachments — Frontend Plan

File uploads on cards. Depends on backend: Express multipart upload
(`POST /api/cards/{cardId}/attachments`) + download
(`GET /api/attachments/{id}/download`), tRPC `attachments.list` /
`attachments.delete`, and card payload `attachmentCount`. Mirror
`features/board` patterns (components in `features/board/components`, call tRPC
with `useTRPC()` + `queryOptions`/`mutationOptions` directly, no custom api
hooks — see `CommentList.tsx`). Upload + download do NOT go through tRPC: upload
is a multipart `XMLHttpRequest` POST (for progress), download is a plain anchor
link. Integration points: `CardEditor.tsx` (Attachments section), `CardTile.tsx`
(count badge, next to `<CommentCountBadge>`).

> CORRECTED permission note: the server enforces delete as uploader-OR-board-
> `owner`, NOT plain `canEdit`. A view-only member cannot upload or delete; a
> plain editor who is not the uploader cannot delete someone else's attachment.
> So the delete button must be gated by `currentUserId === uploaderId || isOwner`
> (mirror how `CommentList`/`CommentItem` receive `currentUserId` + `isOwner`),
> not by `canEdit` alone. Upload is gated by `canEdit` (board `edit`). Always
> handle a server FORBIDDEN/erroring response regardless of UI gating.

## 1. Feature scaffold (`features/board`)
- [x] `types.ts` — re-export `Attachment`, `ATTACHMENT_MAX_BYTES`,
  `ATTACHMENT_ALLOWED_MIME`, `ATTACHMENT_FILENAME_MAX` from `shared` (frontend
  imports `shared` directly; mirror existing re-exports in this file).
- [x] `attachmentErrors.ts` — `attachmentErrorMessage(codeOrError)` mapping every
  `AttachmentError` code (FORBIDDEN, ATTACHMENT_NOT_FOUND, CARD_NOT_FOUND,
  FILE_TOO_LARGE, UNSUPPORTED_TYPE, NO_FILE, FILENAME_TOO_LONG,
  STORAGE_UNAVAILABLE, UNAUTHORIZED) to a user-facing string + a default
  fallback. Must accept BOTH a raw `code` string (from the upload `fetch`/XHR
  JSON error body) AND a tRPC error object (from `attachments.list`/`delete`,
  whose `message` is the error constant) — mirror `commentErrors.ts`'s shape.
- [x] `utils.ts` — `formatBytes(n)` for size display; `isAllowedType(file)` +
  `isWithinSize(file)` for client-side pre-validation against the shared
  constants (fast feedback; server is still the source of truth).

## 2. Upload helper (multipart, non-tRPC)
- [x] `uploadAttachment.ts` — `uploadAttachment({ cardId, file, onProgress }):
  Promise<Attachment>` using `XMLHttpRequest` (for `upload.onprogress`) POST to
  `/api/cards/${cardId}/attachments`, `FormData` with a single file part,
  `xhr.withCredentials = true` (cookie auth), request header
  `x-requested-with: XMLHttpRequest` (the server's CSRF requirement on this
  route). On 2xx resolve with the parsed `Attachment` (note: the JSON body has
  string/number fields — `createdAt` arrives as an ISO string over plain HTTP,
  NOT a `Date` like tRPC's superjson; convert `createdAt` to `Date` when merging
  into the tRPC `list` cache, or keep upload-returned rows separate and rely on
  list invalidation). On non-2xx parse `JSON.parse(xhr.responseText).error` and
  reject with that `code` so callers map it via `attachmentErrorMessage`
  (413 -> FILE_TOO_LARGE, 415 -> UNSUPPORTED_TYPE, 503 -> STORAGE_UNAVAILABLE,
  401 -> UNAUTHORIZED, 403 -> FORBIDDEN). Reject with a generic code on network
  error / non-JSON body.

## 3. Components (`features/board/components`)
- [x] `AttachmentCountBadge.tsx` — paperclip icon (`Paperclip` from
  lucide-react) + count, hidden when `count <= 0`; mirror
  `CommentCountBadge.tsx` exactly (same classes, `aria-label`).
- [x] `AttachmentList.tsx` — props `{ boardId, cardId, canEdit, currentUserId,
  isOwner }`. `useQuery(trpc.attachments.list.queryOptions({ cardId }))`; render
  rows (filename, `formatBytes(sizeBytes)`, download link
  `<a href={'/api/attachments/' + id + '/download'} download>`); loading +
  empty states (mirror CommentList's `isLoading`/empty handling). Per-row delete
  button shown only when `currentUserId === row.uploaderId || isOwner`. Delete
  via `useMutation(trpc.attachments.delete.mutationOptions())` with the
  optimistic pattern from `CommentList.remove`: snapshot list + `boards.getData`,
  remove the row from the list cache, decrement `attachmentCount` via a
  `bumpCount(-1)` helper (copy CommentList's `bumpCount`, swapping
  `commentCount` for `attachmentCount`), `onSuccess: invalidate`,
  `onError`: restore both snapshots. Show `attachmentErrorMessage` on error.
- [x] `AttachmentUpload.tsx` — props `{ boardId, cardId }`, rendered only when
  `canEdit`. File `<input>` (button-styled), `accept` hint built from
  `ATTACHMENT_ALLOWED_MIME`; on select run client pre-validation
  (`isWithinSize` false -> FILE_TOO_LARGE message, `isAllowedType` false ->
  UNSUPPORTED_TYPE message, send NO request); otherwise call `uploadAttachment`
  with a progress bar (state from `onProgress`). On success: optimistically
  `bumpCount(+1)` on `boards.getData`, invalidate the `attachments.list` key, and
  reset the input; on error roll back the bump and show
  `attachmentErrorMessage(code)`.
- [x] `CardTile.tsx` — add
  `<AttachmentCountBadge count={card.attachmentCount} />` next to the existing
  `<CommentCountBadge count={card.commentCount} />` (line ~51).
- [x] `CardEditor.tsx` — add an Attachments section rendering `<AttachmentList>`
  always (read access) and `<AttachmentUpload>` only when `editable`, passing
  `cardId={card.id}`, `boardId`, `canEdit={editable}`, plus `currentUserId` +
  `isOwner` (already available where `CommentList` is rendered — reuse the same
  props CardEditor passes to CommentList).

## 4. Tests (vitest, mock trpc + mock XHR)
- [x] `AttachmentUpload.test.tsx` — selecting an over-cap file shows
  FILE_TOO_LARGE and sends NO request; disallowed type shows UNSUPPORTED_TYPE and
  sends no request; valid file calls `uploadAttachment` and surfaces progress;
  server 503 -> STORAGE_UNAVAILABLE message; rollback of the optimistic count on
  error.
- [x] `AttachmentList.test.tsx` — renders attachments with name + `formatBytes`
  size + correct download `href`; delete calls `attachments.delete`, optimistically
  removes the row and decrements the cached `attachmentCount`, restores on error;
  delete button hidden when the user is neither uploader nor owner; upload absent
  when `canEdit` is false; empty state when none.
- [x] `AttachmentCountBadge.test.tsx` — hidden at 0, shows count otherwise.
- [x] `attachmentErrorMessage` covers every code + unknown fallback + accepts a
  tRPC-error object.

## 5. Verify
- [x] `pnpm --filter frontend test` green
- [x] `pnpm --filter frontend build` clean
- [x] manual: upload a file (progress shown), download it (browser saves the file
  as an attachment, not rendered inline), delete it, count badge updates on the
  tile; oversized + wrong-type rejected client-side with no request; upload
  hidden for a view-only member; delete hidden when not uploader/owner.
