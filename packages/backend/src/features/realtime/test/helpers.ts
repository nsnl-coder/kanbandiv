import type { BoardEvent } from "shared";
import { bus } from "../realtime.bus.js";

export {
  authedCaller,
  newTestDb,
  seedBoard,
  seedBoardAccess,
  seedCard,
  seedColumn,
  seedProject,
  seedUser,
  seedUserCaller,
  type TestDb,
} from "../../board/test/helpers.js";

export {
  seedChecklist,
  seedChecklistItem,
  ownerCard,
} from "../../checklist/test/helpers.js";

// Collect events from the module-level singleton bus (in-proc in tests, since
// REDIS_URL is empty). Returns the captured list + an unsubscribe fn.
export function collect(boardId: string): { events: BoardEvent[]; off: () => void } {
  const events: BoardEvent[] = [];
  const off = bus.subscribe(boardId, (ev) => events.push(ev));
  return { events, off };
}
