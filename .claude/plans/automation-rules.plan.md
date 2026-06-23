# Plan: Automation Rules (Butler-style)

**Source**: feature proposal (free-form)
**Complexity**: Large

## Summary
Per-board rules with a trigger + ordered actions. An engine, invoked from existing
card/checklist mutation sites and a time-based cron, matches enabled rules and runs
actions through existing services so permissions, activity, and notifications stay
consistent. Recursion-guarded and run-logged.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Feature layout | `packages/backend/src/features/card/{card.repo,card.service,card.router}.ts` | repo/service/router + `test/` |
| Activity hook | `card.service.ts:371` (`record(...CARD_MOVED)`) | where triggers fire |
| Cron scheduler | `card/card.reminder.scheduler.ts` | `croner` job wired at startup, idempotent |
| Notify action | `notification/notification.recorder.ts:50` (`create`) | best-effort, never throws |
| Log events | `config/const.config.ts` (`LogEvent`) | no string literals |
| Shared schema | `packages/shared/src/card.schema.ts` + `index.ts` export | zod + types |

## Files to Change
| File | Action | Why |
|---|---|---|
| `packages/backend/src/migrations/031.automation.ts` | CREATE | `automation_rules`, `automation_runs` tables |
| `packages/shared/src/automation.schema.ts` | CREATE | trigger/action zod unions + IO types |
| `packages/shared/src/errors/automation.error.ts` | CREATE | shared error constants |
| `packages/shared/src/index.ts` | UPDATE | export new schema + errors |
| `packages/backend/src/features/automation/automation.repo.ts` | CREATE | rule CRUD + run log |
| `packages/backend/src/features/automation/automation.service.ts` | CREATE | rule CRUD, board-perm via `loadBoardFor` |
| `packages/backend/src/features/automation/automation.engine.ts` | CREATE | match trigger -> run actions, depth guard |
| `packages/backend/src/features/automation/automation.scheduler.ts` | CREATE | cron for `card.due.approaching` |
| `packages/backend/src/features/automation/automation.router.ts` | CREATE | tRPC CRUD + list runs |
| `packages/backend/src/features/automation/test/*.spec.ts` | CREATE | engine + router integration tests |
| `packages/backend/src/features/card/card.service.ts` | UPDATE | invoke engine after move/update (post-`record`) |
| `packages/backend/src/features/checklist/checklist.service.ts` | UPDATE | invoke engine on item complete |
| `packages/backend/src/features/label/label.service.ts` | UPDATE | invoke engine on label added |
| `packages/backend/src/trpc/router.ts` | UPDATE | mount `automation` router |
| `packages/backend/src/config/const.config.ts` | UPDATE | `LogEvent.AutomationRan/Failed/Skipped` |
| `packages/backend/src/index.ts` | UPDATE | start `automation.scheduler` |
| `packages/frontend/src/features/automation/*` | CREATE | rule builder modal + list |

## Data Model
- `automation_rules`: id, board_id (fk), name, enabled bool, trigger jsonb, actions jsonb, created_by, created_at, updated_at.
- `automation_runs`: id, rule_id (fk), card_id null, status (ok|error|skipped), detail jsonb, created_at.

Triggers: `card.moved` (toColumn match), `checklist.completed`, `label.added`, `card.due.approaching` (minutesBefore).
Actions: `move_card`, `set_due`, `add_label`, `assign`, `notify`, `check_all_items`.

## Tasks
> Note: `card.due.approaching` trigger + `automation.scheduler.ts` cron deferred
> (schema ships 3 triggers). Re-add when due-based rules are needed.

### Task 1: [x] schema + migration
- Define trigger/action discriminated unions in `automation.schema.ts`; create tables.
- Validate: `pnpm --filter backend migrate` then `pnpm --filter backend test`.

### Task 2: [x] repo + service + router (CRUD)
- Board-perm `edit` via `loadBoardFor`; mirror card.service error style.
- Validate: router spec green.

### Task 3: [x] engine
- `runForTrigger(db, bus, { boardId, type, context, depth })`. Load enabled rules, filter by trigger match, execute actions via existing services. Guard: `depth >= MAX_DEPTH` -> skip + log run. Per-rule action cap.
- Validate: engine spec covers match, recursion guard, action cap.

### Task 4: [x] wire mutation hooks (cron deferred)
- Call engine after activity `record` in card/checklist/label services (best-effort, never block user action).
- ~~`automation.scheduler.ts` 5-min cron~~ deferred with the due-approaching trigger.
- Validate: backend test + manual move-card triggers rule.

### Task 5: [x] frontend rule builder
- `AutomationManager` under board menu ("Automation"); trigger/action pickers,
  enable toggle, delete, run history. Mirrors `LabelManager`.
- Validate: `pnpm --filter frontend test src/features/automation` green.
- Modal under board menu; trigger/action pickers; enable toggle; run history.
- Validate: `pnpm --filter frontend test`.

## Validation
```bash
pnpm --filter backend migrate
pnpm --filter backend test
pnpm --filter frontend test
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Infinite trigger->action recursion | High | depth counter passed through engine; MAX_DEPTH cap; run log |
| Engine error fails user mutation | Med | engine call best-effort try/catch, like recorder |
| Action runs without re-checking perms | Med | route every action through existing services, not raw SQL |
| jsonb trigger/action drift | Med | re-parse with zod at engine boundary |

## Acceptance
- [ ] Rule CRUD with board-edit permission
- [ ] All 4 triggers + 6 actions execute through services
- [ ] Recursion + action-cap guards proven by tests
- [ ] Run log records ok/error/skipped
- [ ] Patterns mirrored, not reinvented
