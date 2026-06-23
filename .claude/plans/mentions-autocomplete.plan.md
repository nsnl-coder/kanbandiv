# Plan: @mentions Autocomplete (frontend gap only)

**Source**: feature proposal (free-form)
**Complexity**: Small

## NOTE — backend already complete
`@mention` resolution, mention rows, MENTION notification + email, and the prefs gate
already exist in `comment.service.ts:192-231` (`parseMentions`, `insertMentions`,
`createNotification`). The only gap is a frontend mention-autocomplete UX; no backend
or schema change needed.

## Summary
Add a `@` autocomplete popover in the comment composer that suggests board members,
inserts `@handle`, and renders mentions as highlighted tokens in comment bodies.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Composer | `packages/frontend/src/features/board/components/CommentComposer.tsx` | controlled textarea, submit handler |
| Render | `packages/frontend/src/features/board/components/CommentItem.tsx` | body rendering, existing `mentions` field |
| Members source | comment thread already returns `mentions: {id,name}` | handle list |
| Test | `CommentComposer.test.tsx`, `CommentItem.test.tsx` | RTL behavior tests |

## Files to Change
| File | Action | Why |
|---|---|---|
| `packages/frontend/src/features/board/components/MentionAutocomplete.tsx` | CREATE | `@` popover over member handles |
| `packages/frontend/src/features/board/components/CommentComposer.tsx` | UPDATE | detect `@token`, show popover, insert handle |
| `packages/frontend/src/features/board/components/CommentItem.tsx` | UPDATE | highlight `@handle` tokens in body |
| `packages/frontend/src/features/board/components/MentionAutocomplete.test.tsx` | CREATE | filter + select behavior |

## Tasks
### Task 1: member handle source
- Reuse board-members query already used by AssigneePicker (confirm the existing hook).
- Validate: list renders for a seeded board.

### Task 2: autocomplete popover
- On `@` + chars, filter members, keyboard nav (up/down/enter/esc), insert `@handle ` at caret.
- Validate: `MentionAutocomplete.test.tsx`.

### Task 3: render tokens
- In CommentItem, wrap matched `@handle` substrings in a styled span.
- Validate: `CommentItem.test.tsx` updated.

## Validation
```bash
pnpm --filter frontend test
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Handle parsing differs from backend `parseMentions` | Med | mirror the same token rule used server-side |
| Caret insertion bugs | Med | unit-test insert at various caret positions |

## Acceptance
- [ ] `@` suggests board members, inserts handle
- [ ] Mentions highlighted in rendered comments
- [ ] No backend change
- [ ] Parsing matches server `parseMentions`
